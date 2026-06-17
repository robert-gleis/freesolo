export const MIGRATION_002_SQL = `
CREATE TABLE IF NOT EXISTS watcher_intake (
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'ignored')),
  decided_at TEXT NOT NULL,
  issue_updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, issue_number)
);
`.trim();
