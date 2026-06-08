export const EVENT_TYPES = [
  'agent.created',
  'agent.stopped',
  'issue.assigned',
  'verification.failed',
  'verification.passed',
  'team.planned',
  'plan.approved',
  'decomposition.applied',
  'team.created',
  'team.member.blocked',
  'team.tearing-down',
  'team.torn-down',
  'workflow.transition',
  'workflow.refused',
  'review.gate.completed',
  'pr.created'
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CURRENT_EVENT_SCHEMA_VERSION = 1;

export interface EventRecord {
  id: number;
  eventType: EventType;
  agentId: string | null;
  issueId: number | null;
  workflowId: string | null;
  payload: Record<string, unknown>;
  schemaVersion: number;
  createdAt: string;
}

export interface AppendEventInput {
  eventType: EventType;
  agentId?: string;
  issueId?: number;
  workflowId?: string;
  payload?: Record<string, unknown>;
  schemaVersion?: number;
}

export interface EventQuery {
  eventType?: EventType;
  agentId?: string;
  issueId?: number;
  workflowId?: string;
  limit?: number;
}

export type EventLogErrorCode =
  | 'append-failed'
  | 'query-failed'
  | 'invalid-event-type'
  | 'closed';

export class EventLogError extends Error {
  readonly code: EventLogErrorCode;

  constructor(code: EventLogErrorCode, message: string) {
    super(message);
    this.name = 'EventLogError';
    this.code = code;
  }
}

export interface EventLog {
  readonly path: string;
  append(input: AppendEventInput): EventRecord;
  list(query?: EventQuery): EventRecord[];
  close(): void;
}
