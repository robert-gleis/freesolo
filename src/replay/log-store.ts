import { openStateStore } from '../state-store/index.js';
import { ReplayError } from './types.js';

export interface CaptureAgentLogInput {
  agentId: string;
  issueId?: number;
  workflowId?: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface AgentLogSnapshotRecord {
  id: number;
  agentId: string;
  issueId: number | null;
  workflowId: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  createdAt: string;
}

export interface AgentLogStore {
  readonly path: string;
  capture(input: CaptureAgentLogInput): AgentLogSnapshotRecord;
  read(id: number): AgentLogSnapshotRecord | null;
  close(): void;
}

export interface OpenAgentLogStoreOptions {
  path?: string;
  now?: () => Date;
}

function mapRow(row: {
  id: number;
  agent_id: string;
  issue_id: number | null;
  workflow_id: string | null;
  stdout: string;
  stderr: string;
  truncated: number;
  created_at: string;
}): AgentLogSnapshotRecord {
  return {
    id: row.id,
    agentId: row.agent_id,
    issueId: row.issue_id,
    workflowId: row.workflow_id,
    stdout: row.stdout,
    stderr: row.stderr,
    truncated: row.truncated !== 0,
    createdAt: row.created_at
  };
}

export function openAgentLogStore(options: OpenAgentLogStoreOptions = {}): AgentLogStore {
  const store = openStateStore({ path: options.path });
  const now = options.now ?? (() => new Date());
  let closed = false;

  const ensureOpen = (): void => {
    if (closed) {
      throw new ReplayError('closed', `AgentLogStore at ${store.path} is closed`);
    }
  };

  return {
    get path() {
      return store.path;
    },
    capture(input: CaptureAgentLogInput): AgentLogSnapshotRecord {
      ensureOpen();
      const createdAt = now().toISOString();
      try {
        const result = store
          .prepare(
            `INSERT INTO agent_log_snapshots (
              agent_id, issue_id, workflow_id, stdout, stderr, truncated, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.agentId,
            input.issueId ?? null,
            input.workflowId ?? null,
            input.stdout,
            input.stderr,
            input.truncated ? 1 : 0,
            createdAt
          );
        const id = Number(result.lastInsertRowid);
        return {
          id,
          agentId: input.agentId,
          issueId: input.issueId ?? null,
          workflowId: input.workflowId ?? null,
          stdout: input.stdout,
          stderr: input.stderr,
          truncated: input.truncated,
          createdAt
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ReplayError('store-error', message);
      }
    },
    read(id: number): AgentLogSnapshotRecord | null {
      ensureOpen();
      try {
        const row = store
          .prepare('SELECT * FROM agent_log_snapshots WHERE id = ?')
          .get(id) as Parameters<typeof mapRow>[0] | undefined;
        return row ? mapRow(row) : null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ReplayError('store-error', message);
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

