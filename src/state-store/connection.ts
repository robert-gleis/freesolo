import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { StateStoreError } from './types.js';

export function openConnection(dbPath: string): Database.Database {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
    } catch (pragmaError) {
      db.close();
      throw pragmaError;
    }
    return db;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new StateStoreError('open-failed', `Failed to open SQLite database at ${dbPath}: ${cause}`);
  }
}
