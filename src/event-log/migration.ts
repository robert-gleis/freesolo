import type { Migration } from '../state-store/types.js';

export const eventsMigration: Migration = {
  version: 2,
  name: 'events',
  up(db) {
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        agent_id TEXT,
        issue_id INTEGER,
        workflow_id TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_events_event_type ON events (event_type);
      CREATE INDEX idx_events_issue_id ON events (issue_id);
      CREATE INDEX idx_events_agent_id ON events (agent_id);
    `);
  }
};
