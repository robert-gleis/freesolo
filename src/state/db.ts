import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATION_001_SQL } from './migrations/001-watcher.js';
import { MIGRATION_002_SQL } from './migrations/002-watcher-intake.js';

export type StateDb = DatabaseSync;

export function defaultStateDbPath(): string {
  return process.env.ISSUEFLOW_STATE_DB ?? path.join(os.homedir(), '.issueflow', 'state.db');
}

const MIGRATIONS = [
  { version: 1, sql: MIGRATION_001_SQL },
  { version: 2, sql: MIGRATION_002_SQL }
] as const;

function runMigrations(db: StateDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  for (const migration of MIGRATIONS) {
    const applied = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(migration.version);
    if (applied) continue;

    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      migration.version,
      new Date().toISOString()
    );
  }
}

export async function openStateDb(dbPath = defaultStateDbPath()): Promise<StateDb> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  runMigrations(db);
  return db;
}
