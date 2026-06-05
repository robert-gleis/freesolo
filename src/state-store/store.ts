import { openConnection } from './connection.js';
import { runMigrations } from './migrations.js';
import { backup, safeDelete } from './backup.js';
import { resolveDefaultPath, resolveTrashDir } from './paths.js';
import { BASE_MIGRATIONS } from './migrations/index.js';
import {
  StateStoreError,
  type BackupResult,
  type SafeDeleteResult,
  type StateStore,
  type StateStoreOptions
} from './types.js';

export function openStateStore(options: StateStoreOptions = {}): StateStore {
  const dbPath = options.path ?? resolveDefaultPath();
  const migrations = options.migrations ?? BASE_MIGRATIONS;

  const db = openConnection(dbPath);
  try {
    runMigrations(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }

  let closed = false;
  const ensureOpen = (): void => {
    if (closed) {
      throw new StateStoreError('closed', `StateStore at ${dbPath} is closed`);
    }
  };

  const handle: StateStore = {
    path: dbPath,
    get unsafe() {
      ensureOpen();
      return db;
    },
    // Method-syntax passthroughs (not db.prepare.bind(db)) so the generic /
    // overloaded signatures from better-sqlite3 survive. They also call
    // ensureOpen() for consistency with exec/transaction/backup.
    prepare(sql) {
      ensureOpen();
      return db.prepare(sql);
    },
    exec(sql) {
      ensureOpen();
      db.exec(sql);
    },
    transaction(fn) {
      ensureOpen();
      return db.transaction(fn)();
    },
    pragma(source, options) {
      ensureOpen();
      return db.pragma(source, options);
    },
    backup(targetPath) {
      ensureOpen();
      return backup(db, dbPath, targetPath);
    },
    safeDelete(): SafeDeleteResult {
      if (!closed) {
        db.close();
        closed = true;
      }
      return safeDelete(dbPath, resolveTrashDir());
    },
    close() {
      if (closed) {
        return;
      }
      db.close();
      closed = true;
    }
  };

  return handle;
}

export type { BackupResult, SafeDeleteResult, StateStore, StateStoreOptions };
