export const MIGRATION_001_SQL = `
CREATE TABLE IF NOT EXISTS watcher_cursor (
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  last_seen_updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name)
);

CREATE TABLE IF NOT EXISTS watcher_queue (
  id INTEGER PRIMARY KEY,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  enqueued_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT,
  UNIQUE (repo_owner, repo_name, issue_number, issue_updated_at)
);

CREATE INDEX IF NOT EXISTS idx_watcher_queue_pending
  ON watcher_queue (repo_owner, repo_name, status, enqueued_at);
`.trim();
