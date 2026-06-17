import type { StateDb } from './db.js';
import type { RepoRef } from '../workflow/state-store.js';

export type QueueStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface WatcherQueueRow {
  id: number;
  repo_owner: string;
  repo_name: string;
  issue_number: number;
  issue_updated_at: string;
  status: QueueStatus;
  enqueued_at: string;
  processed_at: string | null;
  last_error: string | null;
}

export function getCursor(db: StateDb, repo: RepoRef): string | null {
  const row = db
    .prepare('SELECT last_seen_updated_at FROM watcher_cursor WHERE repo_owner = ? AND repo_name = ?')
    .get(repo.owner, repo.repo) as { last_seen_updated_at: string } | undefined;
  return row?.last_seen_updated_at ?? null;
}

export function setCursor(db: StateDb, repo: RepoRef, isoTimestamp: string): void {
  db.prepare(
    `INSERT INTO watcher_cursor (repo_owner, repo_name, last_seen_updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(repo_owner, repo_name) DO UPDATE SET last_seen_updated_at = excluded.last_seen_updated_at`
  ).run(repo.owner, repo.repo, isoTimestamp);
}

export function enqueueIssue(db: StateDb, repo: RepoRef, issueNumber: number, issueUpdatedAt: string): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO watcher_queue
       (repo_owner, repo_name, issue_number, issue_updated_at, status, enqueued_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`
    )
    .run(repo.owner, repo.repo, issueNumber, issueUpdatedAt, new Date().toISOString());
  return result.changes > 0;
}

export function listPending(db: StateDb, repo: RepoRef): WatcherQueueRow[] {
  return db
    .prepare(
      `SELECT id, repo_owner, repo_name, issue_number, issue_updated_at, status, enqueued_at, processed_at, last_error
       FROM watcher_queue
       WHERE repo_owner = ? AND repo_name = ? AND status = 'pending'
       ORDER BY enqueued_at ASC`
    )
    .all(repo.owner, repo.repo) as unknown as WatcherQueueRow[];
}

export function markProcessing(db: StateDb, id: number): void {
  db.prepare("UPDATE watcher_queue SET status = 'processing' WHERE id = ?").run(id);
}

export function markDone(db: StateDb, id: number): void {
  db.prepare("UPDATE watcher_queue SET status = 'done', processed_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
}

export function markFailed(db: StateDb, id: number, error: string): void {
  db.prepare("UPDATE watcher_queue SET status = 'failed', processed_at = ?, last_error = ? WHERE id = ?").run(
    new Date().toISOString(),
    error,
    id
  );
}

/** Reset processing rows older than staleAfterMs back to pending (crash recovery). Returns count reset. */
export function recoverStaleProcessing(db: StateDb, repo: RepoRef, staleAfterMs: number): number {
  const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
  const result = db
    .prepare(
      `UPDATE watcher_queue
       SET status = 'pending'
       WHERE repo_owner = ? AND repo_name = ? AND status = 'processing' AND enqueued_at < ?`
    )
    .run(repo.owner, repo.repo, cutoff);
  return Number(result.changes);
}

export function isIssueIgnored(db: StateDb, repo: RepoRef, issueNumber: number): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM watcher_ignored
       WHERE repo_owner = ? AND repo_name = ? AND issue_number = ?`
    )
    .get(repo.owner, repo.repo, issueNumber);
  return row !== undefined;
}

export function markIssueIgnored(db: StateDb, repo: RepoRef, issueNumber: number): void {
  db.prepare(
    `INSERT INTO watcher_ignored (repo_owner, repo_name, issue_number, decided_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo_owner, repo_name, issue_number)
     DO UPDATE SET decided_at = excluded.decided_at`
  ).run(repo.owner, repo.repo, issueNumber, new Date().toISOString());
}
