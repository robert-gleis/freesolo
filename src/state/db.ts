import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATION_001_SQL } from './migrations/001-watcher.js';

export type StateDb = DatabaseSync;

export function defaultStateDbPath(): string {
  return process.env.ISSUEFLOW_STATE_DB ?? path.join(os.homedir(), '.issueflow', 'state.db');
}

function runMigrations(db: StateDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (applied) {
    return;
  }

  db.exec(MIGRATION_001_SQL);
  db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
    1,
    new Date().toISOString()
  );
}

export async function openStateDb(dbPath = defaultStateDbPath()): Promise<StateDb> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  runMigrations(db);
  return db;
}
