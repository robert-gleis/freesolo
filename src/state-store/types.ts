import type Database from 'better-sqlite3';

export type StateStoreErrorCode =
  | 'open-failed'
  | 'migration-failed'
  | 'migration-version-conflict'
  | 'backup-failed'
  | 'safe-delete-failed'
  | 'closed';

export class StateStoreError extends Error {
  readonly code: StateStoreErrorCode;

  constructor(code: StateStoreErrorCode, message: string) {
    super(message);
    this.name = 'StateStoreError';
    this.code = code;
  }
}

export interface Migration {
  /** Monotonically increasing integer. Gaps are allowed; ordering is by `version` ascending. */
  version: number;
  /** Short slug for diagnostics. Does not affect ordering. */
  name: string;
  /** Performs the schema change. Called inside a transaction. */
  up: (db: Database.Database) => void;
}

export interface StateStoreOptions {
  /** Override the database path. Defaults to `<FREESOLO_HOME>/state.db` (typically `~/.freesolo/state.db`). */
  path?: string;
  /** Override the migration list. Defaults to `BASE_MIGRATIONS`. */
  migrations?: readonly Migration[];
}

export interface BackupResult {
  path: string;
  bytes: number;
}

export interface SafeDeleteResult {
  trashDir: string;
  movedFiles: string[];
}

export interface StateStore {
  readonly path: string;
  /**
   * Declared as a method (not as `Database.Database['prepare']`) so the
   * generic overload survives implementation via a method-syntax passthrough.
   * `Function.prototype.bind` collapses overloads/generics; using a method
   * preserves them.
   */
  prepare<TParams extends unknown[] = unknown[], TResult = unknown>(
    sql: string
  ): Database.Statement<TParams, TResult>;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  /**
   * Declared as a method to mirror better-sqlite3's overloaded `pragma`
   * signature without collapsing it through `bind`.
   */
  pragma(source: string, options?: { simple?: boolean }): unknown;
  backup(targetPath?: string): BackupResult;
  safeDelete(): SafeDeleteResult;
  close(): void;
  readonly unsafe: Database.Database;
}
