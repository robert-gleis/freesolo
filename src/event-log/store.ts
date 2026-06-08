import { openStateStore } from '../state-store/index.js';
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  EventLogError,
  type AppendEventInput,
  type EventLog,
  type EventQuery,
  type EventRecord,
  type EventType
} from './types.js';

export interface OpenEventLogOptions {
  path?: string;
  now?: () => Date;
}

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

function mapRow(row: {
  id: number;
  event_type: string;
  agent_id: string | null;
  issue_id: number | null;
  workflow_id: string | null;
  payload_json: string;
  schema_version: number;
  created_at: string;
}): EventRecord {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (!isEventType(row.event_type)) {
    throw new EventLogError('query-failed', `stored event_type ${row.event_type} is not canonical`);
  }
  return {
    id: row.id,
    eventType: row.event_type,
    agentId: row.agent_id,
    issueId: row.issue_id,
    workflowId: row.workflow_id,
    payload,
    schemaVersion: row.schema_version,
    createdAt: row.created_at
  };
}

export function openEventLog(options: OpenEventLogOptions = {}): EventLog {
  const store = openStateStore({ path: options.path });
  const now = options.now ?? (() => new Date());
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) {
      throw new EventLogError('closed', `EventLog at ${store.path} is closed`);
    }
  };

  return {
    get path() {
      return store.path;
    },
    append(input: AppendEventInput): EventRecord {
      ensureOpen();
      if (!isEventType(input.eventType)) {
        throw new EventLogError('invalid-event-type', `unknown event type: ${input.eventType}`);
      }
      const createdAt = now().toISOString();
      const schemaVersion = input.schemaVersion ?? CURRENT_EVENT_SCHEMA_VERSION;
      const payloadJson = JSON.stringify(input.payload ?? {});
      try {
        const result = store
          .prepare(
            `INSERT INTO events (
              event_type, agent_id, issue_id, workflow_id,
              payload_json, schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.eventType,
            input.agentId ?? null,
            input.issueId ?? null,
            input.workflowId ?? null,
            payloadJson,
            schemaVersion,
            createdAt
          );
        const id = Number(result.lastInsertRowid);
        return {
          id,
          eventType: input.eventType,
          agentId: input.agentId ?? null,
          issueId: input.issueId ?? null,
          workflowId: input.workflowId ?? null,
          payload: input.payload ?? {},
          schemaVersion,
          createdAt
        };
      } catch (error) {
        if (error instanceof EventLogError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new EventLogError('append-failed', message);
      }
    },
    list(query: EventQuery = {}): EventRecord[] {
      ensureOpen();
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (query.eventType !== undefined) {
        clauses.push('event_type = ?');
        params.push(query.eventType);
      }
      if (query.agentId !== undefined) {
        clauses.push('agent_id = ?');
        params.push(query.agentId);
      }
      if (query.issueId !== undefined) {
        clauses.push('issue_id = ?');
        params.push(query.issueId);
      }
      if (query.workflowId !== undefined) {
        clauses.push('workflow_id = ?');
        params.push(query.workflowId);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      const limit = Math.max(1, Math.min(query.limit ?? 100, 1000));
      try {
        const rows = store
          .prepare(`SELECT * FROM events ${where} ORDER BY id DESC LIMIT ?`)
          .all(...params, limit) as Parameters<typeof mapRow>[0][];
        return rows.map((row) => mapRow(row));
      } catch (error) {
        if (error instanceof EventLogError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        throw new EventLogError('query-failed', message);
      }
    },
    close() {
      if (!closed) {
        store.close();
        closed = true;
      }
    }
  };
}
