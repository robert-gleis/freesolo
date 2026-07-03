import fs from 'node:fs/promises';

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

export interface ClaudeInvokeInput {
  cwd: string;
  prompt: string;
  sessionId?: string;
  /** Cancels the spawned claude process (SIGTERM, escalating to SIGKILL). */
  signal?: AbortSignal;
}

export interface ClaudePrintJson {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

export type ClaudeInvoker = (input: ClaudeInvokeInput) => Promise<ClaudePrintJson>;

export interface ClaudeCodeAgentAdapterOptions {
  binary?: string;
  invoker?: ClaudeInvoker;
}

export class ClaudeCodeAgentAdapter implements AgentAdapter {
  private state: AgentState = 'idle';
  private startedAt?: Date;
  private lastActivityAt?: Date;
  private errorMessage?: string;
  private workingDirectory?: string;
  private sessionId?: string;
  private readonly invoker: ClaudeInvoker;

  constructor(options: ClaudeCodeAgentAdapterOptions = {}) {
    this.invoker = options.invoker ?? createDefaultInvoker(options.binary ?? 'claude');
  }

  async start(input: AgentStartInput): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new AgentAdapterError('invalid-state', `Cannot start from state "${this.state}"`);
    }
    try {
      await fs.access(input.workingDirectory);
    } catch {
      throw new AgentAdapterError(
        'start-failed',
        `Working directory not accessible: ${input.workingDirectory}`
      );
    }
    this.workingDirectory = input.workingDirectory;
    this.state = 'running';
    this.startedAt = new Date();
    this.lastActivityAt = undefined;
    this.errorMessage = undefined;
    this.sessionId = undefined;
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.sessionId = undefined;
    this.state = 'stopped';
  }

  async send(input: string, opts?: SendOptions): Promise<AgentResponse> {
    if (this.state !== 'running' || !this.workingDirectory) {
      throw new AgentAdapterError('invalid-state', `Cannot send while in state "${this.state}"`);
    }
    let payload: ClaudePrintJson;
    try {
      payload = await this.invoker({
        cwd: this.workingDirectory,
        prompt: input,
        sessionId: this.sessionId,
        signal: opts?.signal
      });
    } catch (error) {
      if (error instanceof AgentAdapterError) throw error;
      throw new AgentAdapterError(
        'send-failed',
        error instanceof Error ? error.message : String(error)
      );
    }
    if (payload.is_error || payload.result === undefined) {
      throw new AgentAdapterError('send-failed', 'claude returned no result');
    }
    if (payload.session_id) this.sessionId = payload.session_id;
    this.lastActivityAt = new Date();
    return { output: payload.result };
  }

  async status(): Promise<AgentStatus> {
    const snapshot: AgentStatus = { state: this.state };
    if (this.startedAt) snapshot.startedAt = this.startedAt;
    if (this.lastActivityAt) snapshot.lastActivityAt = this.lastActivityAt;
    if (this.errorMessage) snapshot.error = this.errorMessage;
    return snapshot;
  }
}

function createDefaultInvoker(binary: string): ClaudeInvoker {
  return async ({ cwd, prompt, sessionId, signal }) => {
    const args = ['-p', prompt, '--output-format', 'json'];
    if (sessionId) args.push('--resume', sessionId);
    // On abort/timeout, execa sends SIGTERM (via cancelSignal) and escalates to
    // SIGKILL after forceKillAfterDelay, so the child can't outlive the caller.
    const result = await execa(binary, args, {
      cwd,
      reject: false,
      cancelSignal: signal,
      forceKillAfterDelay: forceKillAfterMs()
    });
    if (result.exitCode !== 0) {
      throw new AgentAdapterError(
        'send-failed',
        `claude exited ${result.exitCode}: ${result.stderr || result.stdout}`
      );
    }
    try {
      return JSON.parse(result.stdout) as ClaudePrintJson;
    } catch {
      throw new AgentAdapterError('send-failed', 'claude returned invalid JSON');
    }
  };
}
