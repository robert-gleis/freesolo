export type AgentState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface AgentStatus {
  state: AgentState;
  startedAt?: Date;
  lastActivityAt?: Date;
  error?: string;
}

export interface AgentStartInput {
  workingDirectory: string;
  initialInstructions?: string;
}

export interface AgentResponse {
  output: string;
}

export interface SendOptions {
  /**
   * Cancels the in-flight send. Adapters backed by a subprocess MUST thread this
   * into their execa call (cancelSignal + forceKillAfterDelay) so an abort/timeout
   * actually terminates the child rather than leaving it running unattended.
   */
  signal?: AbortSignal;
}

export interface AgentAdapter {
  start(input: AgentStartInput): Promise<void>;
  stop(): Promise<void>;
  send(input: string, opts?: SendOptions): Promise<AgentResponse>;
  status(): Promise<AgentStatus>;
}

export type AgentAdapterErrorCode =
  | 'invalid-state'
  | 'start-failed'
  | 'send-failed'
  | 'stop-failed';

export class AgentAdapterError extends Error {
  readonly code: AgentAdapterErrorCode;

  constructor(code: AgentAdapterErrorCode, message: string) {
    super(message);
    this.name = 'AgentAdapterError';
    this.code = code;
  }
}
