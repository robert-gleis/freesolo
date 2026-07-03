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

export interface CodexInvokeInput {
  cwd: string;
  prompt: string;
  threadId?: string;
  /** Cancels the spawned codex process (SIGTERM, escalating to SIGKILL). */
  signal?: AbortSignal;
}

export interface CodexInvokeResult {
  threadId: string;
  output: string;
}

export type CodexInvoker = (input: CodexInvokeInput) => Promise<CodexInvokeResult>;

export interface CodexAgentAdapterOptions {
  binary?: string;
  invoker?: CodexInvoker;
}

export function parseCodexExecJsonl(stdout: string): CodexInvokeResult {
  let threadId: string | undefined;
  let output: string | undefined;

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Tolerate non-JSON noise lines mixed into JSONL stdout.
      continue;
    }

    const type = event.type;
    if (type === 'thread.started' && typeof event.thread_id === 'string') {
      threadId = event.thread_id;
      continue;
    }

    if (type === 'turn.failed') {
      const error = event.error as { message?: string } | undefined;
      throw new Error(error?.message ?? 'turn failed');
    }

    if (type === 'error') {
      const message = typeof event.message === 'string' ? event.message : '';
      if (message.includes('Reconnecting')) continue;
      throw new Error(message || 'codex exec error');
    }

    if (type === 'item.completed') {
      const item = event.item as { type?: string; text?: string } | undefined;
      if (item?.type === 'agent_message' && typeof item.text === 'string') {
        output = item.text;
      }
    }
  }

  if (!threadId) {
    throw new Error('codex exec JSONL missing thread_id');
  }
  if (output === undefined) {
    throw new Error('codex exec JSONL missing agent_message');
  }

  return { threadId, output };
}

export function createDefaultInvoker(binary: string): CodexInvoker {
  return async ({ cwd, prompt, threadId, signal }) => {
    const args = threadId
      ? ['exec', 'resume', threadId, '--json', '-C', cwd, prompt]
      : ['exec', '--json', '-C', cwd, '--skip-git-repo-check', prompt];

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
        `codex exited ${result.exitCode}: ${result.stderr || result.stdout}`
      );
    }

    try {
      return parseCodexExecJsonl(result.stdout);
    } catch (error) {
      throw new AgentAdapterError(
        'send-failed',
        error instanceof Error ? error.message : String(error)
      );
    }
  };
}

export class CodexAgentAdapter implements AgentAdapter {
  private state: AgentState = 'idle';
  private startedAt?: Date;
  private lastActivityAt?: Date;
  private errorMessage?: string;
  private workingDirectory?: string;
  private threadId?: string;
  private readonly invoker: CodexInvoker;

  constructor(options: CodexAgentAdapterOptions = {}) {
    this.invoker = options.invoker ?? createDefaultInvoker(options.binary ?? 'codex');
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
    this.threadId = undefined;
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.threadId = undefined;
    this.state = 'stopped';
  }

  async send(input: string, opts?: SendOptions): Promise<AgentResponse> {
    if (this.state !== 'running' || !this.workingDirectory) {
      throw new AgentAdapterError('invalid-state', `Cannot send while in state "${this.state}"`);
    }

    try {
      const result = await this.invoker({
        cwd: this.workingDirectory,
        prompt: input,
        threadId: this.threadId,
        signal: opts?.signal
      });
      this.threadId = result.threadId;
      this.lastActivityAt = new Date();
      return { output: result.output };
    } catch (error) {
      if (error instanceof AgentAdapterError) {
        this.state = 'error';
        this.errorMessage = error.message;
        throw error;
      }
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
