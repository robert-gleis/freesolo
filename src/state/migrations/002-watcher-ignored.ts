export const MIGRATION_002_SQL = `
CREATE TABLE IF NOT EXISTS watcher_ignored (
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  -- audit-only timestamp; never read in logic, do not "clean up"
  decided_at TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, issue_number)
);
`.trim();
