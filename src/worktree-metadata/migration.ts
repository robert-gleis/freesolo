import type { Migration } from '../state-store/types.js';

export const worktreesMigration: Migration = {
  version: 3,
  name: 'worktrees',
  up(db) {
    db.exec(`
      CREATE TABLE worktrees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        branch TEXT NOT NULL,
        agent_owner TEXT,
        issue_id INTEGER,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX idx_worktrees_issue_id ON worktrees (issue_id);
      CREATE INDEX idx_worktrees_branch ON worktrees (branch);
    `);
  }
};
