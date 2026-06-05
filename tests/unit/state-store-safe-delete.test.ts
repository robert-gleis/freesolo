import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { safeDelete } from '../../src/state-store/backup.js';
import { StateStoreError } from '../../src/state-store/types.js';

const tempDirs: string[] = [];

async function seedDb(): Promise<{ dir: string; dbPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-delete-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'state.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE t (n INTEGER)');
  db.prepare('INSERT INTO t (n) VALUES (1)').run();
  // Checkpoint-then-TRUNCATE so close() leaves only state.db on disk; this
  // makes the strict-equality assertion on `movedFiles` contractually safe
  // rather than relying on SQLite's default close-time checkpoint behaviour.
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  return { dir, dbPath };
}

async function seedDbLeavingWal(): Promise<{ dir: string; dbPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-delete-wal-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'state.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  // Disable auto-checkpoint on this connection so WAL/SHM survive close().
  db.pragma('wal_autocheckpoint = 0');
  db.exec('CREATE TABLE t (n INTEGER)');
  db.prepare('INSERT INTO t (n) VALUES (1)').run();
  db.close();
  return { dir, dbPath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('safeDelete', () => {
  it('moves state.db plus existing WAL/SHM siblings into the trash dir', async () => {
    const { dir, dbPath } = await seedDb();
    const trashRoot = path.join(dir, 'trash', '2026-06-04T17-23-18-499Z');

    const result = safeDelete(dbPath, trashRoot);

    expect(result.trashDir).toBe(trashRoot);
    expect(result.movedFiles.sort()).toEqual(['state.db'].sort());
    await expect(fs.stat(dbPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(trashRoot, 'state.db'))).resolves.toBeDefined();
  });

  it('also moves -wal and -shm when present', async () => {
    const { dir, dbPath } = await seedDbLeavingWal();
    const trashRoot = path.join(dir, 'trash', 'r2');

    // Snapshot pre-existence of -wal/-shm BEFORE calling safeDelete. After the
    // call the source files will be gone (moved or never existed), so we have
    // to capture this state up front in order to assert anything meaningful.
    const preExisting: string[] = [];
    for (const sibling of ['state.db-wal', 'state.db-shm']) {
      const exists = await fs
        .stat(path.join(dir, sibling))
        .then(() => true)
        .catch(() => false);
      if (exists) {
        preExisting.push(sibling);
      }
    }

    const result = safeDelete(dbPath, trashRoot);

    // The DB file must always be in the moved list.
    expect(result.movedFiles).toContain('state.db');

    // Every sibling that was present before the call must now be (a) gone
    // from the source dir, (b) present under trashRoot, and (c) reported in
    // result.movedFiles.
    for (const sibling of preExisting) {
      await expect(fs.stat(path.join(dir, sibling))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(path.join(trashRoot, sibling))).resolves.toBeDefined();
      expect(result.movedFiles).toContain(sibling);
    }
  });

  it('is idempotent when the database file is already absent', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-delete-missing-'));
    tempDirs.push(dir);
    const dbPath = path.join(dir, 'state.db');
    const trashRoot = path.join(dir, 'trash', 'r3');

    const result = safeDelete(dbPath, trashRoot);

    expect(result.movedFiles).toEqual([]);
    expect(result.trashDir).toBe(trashRoot);
  });

  it('wraps failures in StateStoreError("safe-delete-failed")', async () => {
    const { dbPath } = await seedDb();

    try {
      safeDelete(dbPath, '/\x00bad/trash');
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StateStoreError);
      expect((error as StateStoreError).code).toBe('safe-delete-failed');
    }
  });
});
