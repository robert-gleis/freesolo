import {
  AgentAdapterError,
  type AgentAdapter,
  type AgentResponse,
  type AgentStartInput,
  type AgentState,
  type AgentStatus,
  type SendOptions
} from './types.js';

export interface ScriptStep {
  match: string | RegExp;
  output: string;
}

export interface AgentScript {
  steps: ScriptStep[];
  fallback?: string;
}

export class ScriptedAgentAdapter implements AgentAdapter {
  private state: AgentState = 'idle';
  private startedAt?: Date;
  private lastActivityAt?: Date;
  private errorMessage?: string;
  private readonly script: AgentScript;

  constructor(script: AgentScript) {
    this.script = script;
  }

  async start(_input: AgentStartInput): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new AgentAdapterError(
        'invalid-state',
        `Cannot start from state "${this.state}"`
      );
    }
    this.state = 'running';
    this.startedAt = new Date();
    this.lastActivityAt = undefined;
    this.errorMessage = undefined;
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.state = 'stopped';
  }

  async send(input: string, opts?: SendOptions): Promise<AgentResponse> {
    if (this.state !== 'running') {
      throw new AgentAdapterError(
        'invalid-state',
        `Cannot send while in state "${this.state}"`
      );
    }

    // Honor an already-aborted signal so tests can drive the cancellation path
    // deterministically (mirrors how a real subprocess adapter would bail).
    if (opts?.signal?.aborted) {
      throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    for (const step of this.script.steps) {
      if (matches(step.match, input)) {
        this.lastActivityAt = new Date();
        return { output: step.output };
      }
    }

    if (this.script.fallback !== undefined) {
      this.lastActivityAt = new Date();
      return { output: this.script.fallback };
    }

    throw new AgentAdapterError(
      'send-failed',
      `No script step matched input: ${input}`
    );
  }

  async status(): Promise<AgentStatus> {
    const snapshot: AgentStatus = { state: this.state };
    if (this.startedAt) snapshot.startedAt = this.startedAt;
    if (this.lastActivityAt) snapshot.lastActivityAt = this.lastActivityAt;
    if (this.errorMessage) snapshot.error = this.errorMessage;
    return snapshot;
  }
}

// A string `match` is exact case-sensitive equality; use a RegExp for substring or case-insensitive matching.
function matches(match: string | RegExp, input: string): boolean {
  if (typeof match === 'string') return match === input;
  return match.test(input);
}
