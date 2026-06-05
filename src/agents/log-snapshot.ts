export interface AgentLogSnapshot {
  stdout: string;
  stderr: string;
  combined: string;
  truncated: boolean;
}

export interface AgentLogOptions {
  sinceByteOffset?: number;
}
