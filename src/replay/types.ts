export type ReplayStep =
  | {
      kind: 'workflow.decision';
      at: string;
      fromState: string | null;
      action: Record<string, unknown>;
    }
  | {
      kind: 'workflow.transition';
      at: string;
      from: string;
      to: string;
    }
  | {
      kind: 'agent.lifecycle';
      at: string;
      eventType: 'agent.created' | 'agent.stopped';
      agentId: string;
      payload: Record<string, unknown>;
    }
  | {
      kind: 'agent.log';
      at: string;
      agentId: string;
      stdout: string;
      stderr: string;
      truncated: boolean;
    };

export interface WorkflowReplay {
  issueId: number;
  workflowId: string | null;
  steps: ReplayStep[];
  startedAt: string | null;
  endedAt: string | null;
}

export type ReplayErrorCode = 'no-events' | 'store-error' | 'closed';

export class ReplayError extends Error {
  readonly code: ReplayErrorCode;

  constructor(code: ReplayErrorCode, message: string) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
  }
}
