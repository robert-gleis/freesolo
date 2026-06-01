export type RunnerId = string;

export type RunnerState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface RunnerStatus {
  state: RunnerState;
  startedAt?: Date;
  stoppedAt?: Date;
  exitCode?: number;
  error?: string;
}

export interface SpawnSpec {
  binary: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface LogSnapshot {
  stdout: string;
  stderr: string;
  combined: string;
  truncated: boolean;
}

export interface LogOptions {
  sinceByteOffset?: number;
}

export interface Runner {
  readonly id: RunnerId;
  spawn(spec: SpawnSpec): Promise<void>;
  stop(): Promise<void>;
  logs(options?: LogOptions): Promise<LogSnapshot>;
  status(): Promise<RunnerStatus>;
}

export type RunnerErrorCode =
  | 'invalid-state'
  | 'spawn-failed'
  | 'stop-failed'
  | 'logs-unavailable';

export class RunnerError extends Error {
  readonly code: RunnerErrorCode;

  constructor(code: RunnerErrorCode, message: string) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
  }
}
