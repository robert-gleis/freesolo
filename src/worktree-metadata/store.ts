import path from 'node:path';

import type { StateStore } from '../state-store/types.js';

export interface WorktreeRecord {
  id: number;
  path: string;
  branch: string;
  agentOwner: string | null;
  issueId: number | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface UpsertWorktreeInput {
  path: string;
  branch: string;
  agentOwner?: string | null;
  issueId?: number | null;
  now?: string;
}

export class WorktreeNotFoundError extends Error {
  constructor(worktreePath: string) {
    super(`Worktree metadata not found for path ${worktreePath}`);
    this.name = 'WorktreeNotFoundError';
  }
}

interface WorktreeRow {
  id: number;
  path: string;
  branch: string;
  agent_owner: string | null;
  issue_id: number | null;
  created_at: string;
  last_seen_at: string;
}

function normalizePath(worktreePath: string): string {
  return path.resolve(worktreePath);
}

function mapRow(row: WorktreeRow): WorktreeRecord {
  return {
    id: row.id,
    path: row.path,
    branch: row.branch,
    agentOwner: row.agent_owner,
    issueId: row.issue_id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

export class WorktreeMetadataStore {
  constructor(private readonly db: StateStore) {}

  upsert(input: UpsertWorktreeInput): WorktreeRecord {
    const now = input.now ?? new Date().toISOString();
    const normalizedPath = normalizePath(input.path);

    this.db
      .prepare(
        `INSERT INTO worktrees (path, branch, agent_owner, issue_id, created_at, last_seen_at)
         VALUES (@path, @branch, @agentOwner, @issueId, @now, @now)
         ON CONFLICT(path) DO UPDATE SET
           branch = excluded.branch,
           agent_owner = excluded.agent_owner,
           issue_id = excluded.issue_id,
           last_seen_at = excluded.last_seen_at`
      )
      .run({
        path: normalizedPath,
        branch: input.branch,
        agentOwner: input.agentOwner ?? null,
        issueId: input.issueId ?? null,
        now
      });

    const row = this.getByPath(normalizedPath);
    if (!row) {
      throw new Error(`Failed to read worktree metadata after upsert for ${normalizedPath}`);
    }

    return row;
  }

  getByPath(worktreePath: string): WorktreeRecord | null {
    const row = this.db
      .prepare('SELECT * FROM worktrees WHERE path = ?')
      .get(normalizePath(worktreePath)) as WorktreeRow | undefined;

    return row ? mapRow(row) : null;
  }

  list(): WorktreeRecord[] {
    const rows = this.db.prepare('SELECT * FROM worktrees ORDER BY last_seen_at DESC').all() as WorktreeRow[];

    return rows.map(mapRow);
  }

  deleteByPath(worktreePath: string): boolean {
    const result = this.db.prepare('DELETE FROM worktrees WHERE path = ?').run(normalizePath(worktreePath));
    return result.changes > 0;
  }

  touch(worktreePath: string, now = new Date().toISOString()): WorktreeRecord {
    const normalizedPath = normalizePath(worktreePath);
    const result = this.db.prepare('UPDATE worktrees SET last_seen_at = ? WHERE path = ?').run(now, normalizedPath);

    if (result.changes === 0) {
      throw new WorktreeNotFoundError(normalizedPath);
    }

    const row = this.getByPath(normalizedPath);
    if (!row) {
      throw new WorktreeNotFoundError(normalizedPath);
    }

    return row;
  }
}
