import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { issueflowHome } from '../core/paths.js';
import { MIGRATION_001_SQL } from './migrations/001-watcher.js';
import { MIGRATION_002_SQL } from './migrations/002-watcher-ignored.js';

export type StateDb = DatabaseSync;

export function defaultStateDbPath(): string {
  return process.env.ISSUEFLOW_STATE_DB ?? path.join(issueflowHome(), 'state.db');
}

const MIGRATIONS = [
  { version: 1, sql: MIGRATION_001_SQL },
  { version: 2, sql: MIGRATION_002_SQL }
] as const;

const WATCHER_MIGRATIONS_TABLE = 'watcher_schema_migrations';

function runMigrations(db: StateDb): void {
  db.exec(`CREATE TABLE IF NOT EXISTS ${WATCHER_MIGRATIONS_TABLE} (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);

  for (const migration of MIGRATIONS) {
    const applied = db
      .prepare(`SELECT version FROM ${WATCHER_MIGRATIONS_TABLE} WHERE version = ?`)
      .get(migration.version);
    if (applied) continue;

    db.exec(migration.sql);
    db.prepare(`INSERT INTO ${WATCHER_MIGRATIONS_TABLE} (version, applied_at) VALUES (?, ?)`).run(
      migration.version,
      new Date().toISOString()
    );
  }
}

export async function openStateDb(dbPath = defaultStateDbPath()): Promise<StateDb> {
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  db.exec('PRAGMA synchronous=NORMAL');
  db.exec('PRAGMA busy_timeout=5000');
  runMigrations(db);
  return db;
}
