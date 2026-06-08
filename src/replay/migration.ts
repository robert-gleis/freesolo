import type { Migration } from '../state-store/types.js';

export const agentLogSnapshotsMigration: Migration = {
  version: 4,
  name: 'agent_log_snapshots',
  up(db) {
    db.exec(`
      CREATE TABLE agent_log_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        issue_id INTEGER,
        workflow_id TEXT,
        stdout TEXT NOT NULL DEFAULT '',
        stderr TEXT NOT NULL DEFAULT '',
        truncated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_agent_log_snapshots_issue_id ON agent_log_snapshots (issue_id);
      CREATE INDEX idx_agent_log_snapshots_agent_id ON agent_log_snapshots (agent_id);
    `);
  }
};
