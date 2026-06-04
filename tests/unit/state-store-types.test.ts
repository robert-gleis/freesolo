import { describe, expect, it } from 'vitest';

import {
  StateStoreError,
  type BackupResult,
  type Migration,
  type SafeDeleteResult,
  type StateStore,
  type StateStoreErrorCode,
  type StateStoreOptions
} from '../../src/state-store/types.js';

describe('StateStoreError', () => {
  it('carries a code and message and is an Error', () => {
    const error = new StateStoreError('open-failed', 'cannot open');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('StateStoreError');
    expect(error.code).toBe('open-failed');
    expect(error.message).toBe('cannot open');
  });

  it('supports every documented error code', () => {
    const codes: readonly StateStoreErrorCode[] = [
      'open-failed',
      'migration-failed',
      'migration-version-conflict',
      'backup-failed',
      'safe-delete-failed',
      'closed'
    ];

    for (const code of codes) {
      const error = new StateStoreError(code, code);
      expect(error.code).toBe(code);
    }
  });
});

describe('state-store types (structural)', () => {
  it('Migration declares version, name, up', () => {
    const migration: Migration = {
      version: 1,
      name: 'init',
      up: (_db) => {
        // no-op for type check
      }
    };

    expect(migration.version).toBe(1);
    expect(migration.name).toBe('init');
    expect(typeof migration.up).toBe('function');
  });

  it('StateStoreOptions allows path and migrations overrides', () => {
    const opts: StateStoreOptions = { path: '/tmp/x.db', migrations: [] };
    expect(opts.path).toBe('/tmp/x.db');
    expect(opts.migrations).toEqual([]);
  });

  it('BackupResult and SafeDeleteResult shapes', () => {
    const backup: BackupResult = { path: '/tmp/x.db.backup', bytes: 1024 };
    const safeDelete: SafeDeleteResult = { trashDir: '/tmp/trash/1', movedFiles: ['x.db'] };

    expect(backup.bytes).toBe(1024);
    expect(safeDelete.movedFiles).toEqual(['x.db']);
  });

  it('StateStore exposes the documented surface', () => {
    // Compile-time check only — verify the type is shaped correctly via an
    // assignment from a partial declaration.
    const surface: keyof StateStore = 'path';
    expect(surface).toBe('path');
  });
});
