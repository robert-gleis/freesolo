import { execa } from 'execa';

import { forceKillAfterMs } from '../core/exec-cancel.js';
import {
  AgentAdapterError,
  type AgentAdapter,
  type AgentResponse,
  type AgentStartInput,
  type AgentState,
  type AgentStatus,
  type SendOptions
} from './types.js';

export interface CursorAgentRunResult {
  sessionId: string;
  output: string;
}

export interface CursorAgentRunOptions {
  cwd?: string;
  /** Cancels the spawned cursor-agent process (SIGTERM, escalating to SIGKILL). */
  signal?: AbortSignal;
}

export interface CursorAgentDeps {
  binary?: string;
  run: (args: string[], options?: CursorAgentRunOptions) => Promise<CursorAgentRunResult>;
}

export function parseCursorAgentJson(stdout: string): CursorAgentRunResult {
  const lines = stdout.trim().split('\n').filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.startsWith('{')) continue;
    const payload = JSON.parse(line) as { session_id?: string; result?: string };
    if (typeof payload.result !== 'string') {
      throw new Error('cursor-agent JSON missing result field');
    }
    if (typeof payload.session_id !== 'string') {
      throw new Error('cursor-agent JSON missing session_id field');
    }
    return { sessionId: payload.session_id, output: payload.result };
  }
  throw new Error('cursor-agent stdout contained no JSON line');
}

export function createDefaultCursorAgentDeps(binary = 'cursor-agent'): CursorAgentDeps {
  return {
    binary,
    async run(args: string[], options?: CursorAgentRunOptions) {
      const subcommand = args[0];
      if (subcommand === 'create-chat') {
        const { stdout } = await execa(binary, ['create-chat'], { cwd: options?.cwd });
        const sessionId = stdout.trim();
        if (!sessionId) throw new Error('create-chat returned empty session id');
        return { sessionId, output: '' };
      }
      // On abort/timeout, execa sends SIGTERM (via cancelSignal) and escalates to
      // SIGKILL after forceKillAfterDelay, so the child can't outlive the caller.
      const { stdout } = await execa(binary, args, {
        cancelSignal: options?.signal,
        forceKillAfterDelay: forceKillAfterMs()
      });
      return parseCursorAgentJson(stdout);
    }
  };
}

export function createCursorAgentAdapter(
  deps: CursorAgentDeps = createDefaultCursorAgentDeps()
): CursorAgentAdapter {
  return new CursorAgentAdapter(deps);
}

export class CursorAgentAdapter implements AgentAdapter {
  private state: AgentState = 'idle';
  private startedAt?: Date;
  private lastActivityAt?: Date;
  private errorMessage?: string;
  private sessionId?: string;
  private workingDirectory?: string;
  private readonly deps: CursorAgentDeps;

  constructor(deps: CursorAgentDeps = createDefaultCursorAgentDeps()) {
    this.deps = deps;
  }

  async start(input: AgentStartInput): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new AgentAdapterError('invalid-state', `Cannot start from state "${this.state}"`);
    }
    this.state = 'starting';
    this.workingDirectory = input.workingDirectory;
    this.errorMessage = undefined;
    this.lastActivityAt = undefined;
    try {
      const result = await this.deps.run(['create-chat'], { cwd: input.workingDirectory });
      this.sessionId = result.sessionId;
      this.state = 'running';
      this.startedAt = new Date();
    } catch (error) {
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      throw new AgentAdapterError('start-failed', this.errorMessage);
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.state = 'stopping';
    this.sessionId = undefined;
    this.state = 'stopped';
  }

  async send(input: string, opts?: SendOptions): Promise<AgentResponse> {
    if (this.state !== 'running' || !this.sessionId) {
      throw new AgentAdapterError('invalid-state', `Cannot send while in state "${this.state}"`);
    }
    try {
      const result = await this.deps.run(
        [
          '--resume',
          this.sessionId,
          '--print',
          '--trust',
          '--output-format',
          'json',
          '--workspace',
          this.workingDirectory!,
          input
        ],
        { cwd: this.workingDirectory, signal: opts?.signal }
      );
      this.sessionId = result.sessionId;
      this.lastActivityAt = new Date();
      return { output: result.output };
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
}
