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

export interface AgentAdapter {
  start(input: AgentStartInput): Promise<void>;
  stop(): Promise<void>;
  send(input: string): Promise<AgentResponse>;
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
