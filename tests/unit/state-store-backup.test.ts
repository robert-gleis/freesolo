import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { backup } from '../../src/state-store/backup.js';
import { StateStoreError } from '../../src/state-store/types.js';

const tempDirs: string[] = [];

async function makeSourceDb(): Promise<{ db: Database.Database; dir: string; dbPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-backup-'));
  tempDirs.push(dir);
  const dbPath = path.join(dir, 'state.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE t (n INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO t (n) VALUES (?), (?), (?)').run(1, 2, 3);
  return { db, dir, dbPath };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('backup', () => {
  it('writes a readable SQLite file with the same rows', async () => {
    const { db, dir, dbPath } = await makeSourceDb();
    const target = path.join(dir, 'state.backup.db');

    const result = backup(db, dbPath, target);

    expect(result.path).toBe(target);
    expect(result.bytes).toBeGreaterThan(0);
    db.close();

    const restored = new Database(target);
    const rows = (restored.prepare('SELECT n FROM t ORDER BY n').all() as Array<{ n: number }>).map((row) => row.n);
    expect(rows).toEqual([1, 2, 3]);
    restored.close();
  });

  it('uses a default target path next to the source when none is provided', async () => {
    const { db, dir, dbPath } = await makeSourceDb();

    const result = backup(db, dbPath, undefined, new Date('2026-06-04T17:23:18.499Z'));

    expect(result.path).toBe(path.join(dir, 'state.db.backup-2026-06-04T17-23-18-499Z.db'));
    db.close();
  });

  it('wraps failures in StateStoreError("backup-failed")', async () => {
    const { db } = await makeSourceDb();

    try {
      backup(db, '/source-path-unused', '/nonexistent-dir/backup.db');
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StateStoreError);
      expect((error as StateStoreError).code).toBe('backup-failed');
    }

    db.close();
  });
});
