import {
  AgentAdapterError,
  type AgentAdapter,
  type AgentResponse,
  type AgentStartInput,
  type AgentState,
  type AgentStatus
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
    throw new AgentAdapterError('stop-failed', 'not implemented yet');
  }

  async send(_input: string): Promise<AgentResponse> {
    throw new AgentAdapterError('send-failed', 'not implemented yet');
  }

  async status(): Promise<AgentStatus> {
    const snapshot: AgentStatus = { state: this.state };
    if (this.startedAt) snapshot.startedAt = this.startedAt;
    if (this.lastActivityAt) snapshot.lastActivityAt = this.lastActivityAt;
    if (this.errorMessage) snapshot.error = this.errorMessage;
    return snapshot;
  }
}
