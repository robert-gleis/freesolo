import fs from 'node:fs/promises';

import type { AgentLogOptions, AgentLogSnapshot } from './log-snapshot.js';
import {
  createInMemoryPiTransport,
  createNodePiTransport,
  PiRpcSession,
  type InMemoryPiTransport,
  type PiTransport
} from './pi-rpc.js';
import {
  AgentAdapterError,
  type AgentAdapter,
  type AgentResponse,
  type AgentStartInput,
  type AgentState,
  type AgentStatus
} from './types.js';

const DEFAULT_PI_ARGS = ['--mode', 'rpc', '--offline', '--no-session'] as const;
const DEFAULT_LOG_CAP_BYTES = 1024 * 1024;

export type PiTransportFactory = () => PiTransport;

export interface PiAgentAdapterOptions {
  binary?: string;
  maxLogBytes?: number;
  transportFactory?: PiTransportFactory;
  access?: (path: string) => Promise<void>;
  env?: Record<string, string>;
}

function buildCombined(stdout: string, stderr: string): string {
  const parts: string[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length > 0) parts.push(`[stdout] ${line}`);
  }
  for (const line of stderr.split('\n')) {
    if (line.length > 0) parts.push(`[stderr] ${line}`);
  }
  return parts.join('\n');
}

class LogRingBuffer {
  private stdout = '';
  private stderr = '';
  private truncated = false;

  constructor(private readonly maxBytes: number) {}

  appendStdout(chunk: string): void {
    this.stdout += chunk;
    this.enforceCap();
  }

  appendStderr(chunk: string): void {
    this.stderr += chunk;
    this.enforceCap();
  }

  private enforceCap(): void {
    let combined = this.stdout.length + this.stderr.length;
    if (combined <= this.maxBytes) {
      return;
    }

    this.truncated = true;
    while (combined > this.maxBytes && (this.stdout.length > 0 || this.stderr.length > 0)) {
      if (this.stdout.length >= this.stderr.length && this.stdout.length > 0) {
        this.stdout = this.stdout.slice(1);
      } else if (this.stderr.length > 0) {
        this.stderr = this.stderr.slice(1);
      } else {
        break;
      }
      combined = this.stdout.length + this.stderr.length;
    }
  }

  snapshot(): AgentLogSnapshot {
    return {
      stdout: this.stdout,
      stderr: this.stderr,
      combined: buildCombined(this.stdout, this.stderr),
      truncated: this.truncated
    };
  }
}

export class PiAgentAdapter implements AgentAdapter {
  private state: AgentState = 'idle';
  private startedAt?: Date;
  private lastActivityAt?: Date;
  private errorMessage?: string;
  private transport?: PiTransport;
  private session?: PiRpcSession;
  private readonly logBuffer: LogRingBuffer;
  private readonly options: PiAgentAdapterOptions;

  constructor(options: PiAgentAdapterOptions = {}) {
    this.options = options;
    this.logBuffer = new LogRingBuffer(options.maxLogBytes ?? DEFAULT_LOG_CAP_BYTES);
  }

  async start(input: AgentStartInput): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new AgentAdapterError(
        'invalid-state',
        `Cannot start from state "${this.state}"`
      );
    }

    const access = this.options.access ?? ((path: string) => fs.access(path));
    try {
      await access(input.workingDirectory);
    } catch {
      this.state = 'error';
      this.errorMessage = `working directory not accessible: ${input.workingDirectory}`;
      throw new AgentAdapterError('start-failed', this.errorMessage);
    }

    this.state = 'starting';
    this.errorMessage = undefined;

    const transportFactory =
      this.options.transportFactory ?? (() => createNodePiTransport());
    const transport = transportFactory();
    this.wireTransport(transport);

    try {
      await transport.spawn({
        binary: this.options.binary ?? 'pi',
        args: [...DEFAULT_PI_ARGS],
        cwd: input.workingDirectory,
        env: this.options.env
      });
    } catch (error) {
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      throw new AgentAdapterError('start-failed', this.errorMessage);
    }

    this.session = new PiRpcSession(transport);
    this.attachSessionStdout(this.session);
    this.state = 'running';
    this.startedAt = new Date();
    this.lastActivityAt = undefined;

    if (input.initialInstructions) {
      await this.send(input.initialInstructions);
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';

    try {
      await this.session?.abort();
    } catch {
      // best-effort
    }

    try {
      await this.transport?.kill();
    } catch {
      // best-effort
    }

    this.state = 'stopped';
    this.session = undefined;
    this.transport = undefined;
  }

  async send(input: string): Promise<AgentResponse> {
    if (this.state !== 'running' || !this.session) {
      throw new AgentAdapterError(
        'invalid-state',
        `Cannot send while in state "${this.state}"`
      );
    }

    try {
      await this.session.prompt(input);
      const output = await this.session.getLastAssistantText();
      this.lastActivityAt = new Date();
      return { output };
    } catch (error) {
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      throw new AgentAdapterError('send-failed', this.errorMessage);
    }
  }

  async status(): Promise<AgentStatus> {
    const snapshot: AgentStatus = { state: this.state };
    if (this.startedAt) snapshot.startedAt = this.startedAt;
    if (this.lastActivityAt) snapshot.lastActivityAt = this.lastActivityAt;
    if (this.errorMessage) snapshot.error = this.errorMessage;
    return snapshot;
  }

  async readLogs(_options?: AgentLogOptions): Promise<AgentLogSnapshot> {
    return this.logBuffer.snapshot();
  }

  private stdoutSink: ((line: string) => void) | undefined;

  private wireTransport(transport: PiTransport): void {
    this.transport = transport;
    transport.onStdoutLine((line) => {
      this.logBuffer.appendStdout(`${line}\n`);
      this.stdoutSink?.(line);
    });
    transport.onStderr((chunk) => {
      this.logBuffer.appendStderr(chunk);
    });
    transport.onClose((code) => {
      if (this.state === 'running' || this.state === 'starting' || this.state === 'stopping') {
        this.state = 'error';
        this.errorMessage =
          code === null ? 'pi process exited unexpectedly' : `pi process exited with code ${code}`;
      }
    });
  }

  private attachSessionStdout(session: PiRpcSession): void {
    this.stdoutSink = (line) => {
      session.feedStdout(`${line}\n`);
    };
  }
}

export { createInMemoryPiTransport, type InMemoryPiTransport };
