import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/state-store/migrations.js';
import { StateStoreError, type Migration } from '../../src/state-store/types.js';

const tempDirs: string[] = [];
const openDbs: Database.Database[] = [];

async function makeDb(): Promise<{ db: Database.Database; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-mig-'));
  tempDirs.push(dir);
  const db = new Database(path.join(dir, 'state.db'));
  openDbs.push(db);
  return { db, dir };
}

afterEach(async () => {
  for (const db of openDbs.splice(0)) {
    if (db.open) {
      db.close();
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const createA: Migration = {
  version: 1,
  name: 'create-a',
  up: (db) => {
    db.exec('CREATE TABLE a (n INTEGER PRIMARY KEY)');
  }
};

const createB: Migration = {
  version: 2,
  name: 'create-b',
  up: (db) => {
    db.exec('CREATE TABLE b (n INTEGER PRIMARY KEY)');
  }
};

describe('runMigrations', () => {
  it('creates schema_migrations and applies migrations in version order', async () => {
    const { db } = await makeDb();

    runMigrations(db, [createB, createA]);

    const rows = db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string }>;
    expect(rows).toEqual([
      { version: 1, name: 'create-a' },
      { version: 2, name: 'create-b' }
    ]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='a'").get()).toBeDefined();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='b'").get()).toBeDefined();
  });

  it('is idempotent across repeated calls', async () => {
    const { db } = await makeDb();
    runMigrations(db, [createA, createB]);
    runMigrations(db, [createA, createB]);

    const count = (db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as { c: number }).c;
    expect(count).toBe(2);
  });

  it('only applies new versions on second open', async () => {
    const { db } = await makeDb();
    runMigrations(db, [createA]);

    const calls: number[] = [];
    const createBInstrumented: Migration = {
      version: 2,
      name: 'create-b',
      up: (innerDb) => {
        calls.push(2);
        innerDb.exec('CREATE TABLE b (n INTEGER PRIMARY KEY)');
      }
    };

    runMigrations(db, [createA, createBInstrumented]);

    expect(calls).toEqual([2]);
  });

  it('rolls back a failing migration and surfaces migration-failed', async () => {
    const { db } = await makeDb();
    const failing: Migration = {
      version: 2,
      name: 'will-fail',
      up: (innerDb) => {
        innerDb.exec('CREATE TABLE b (n INTEGER PRIMARY KEY)');
        throw new Error('boom');
      }
    };

    try {
      runMigrations(db, [createA, failing]);
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StateStoreError);
      expect((error as StateStoreError).code).toBe('migration-failed');
      expect((error as StateStoreError).message).toContain('2');
      expect((error as StateStoreError).message).toContain('will-fail');
    }

    const versions = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>).map((row) => row.version);
    expect(versions).toEqual([1]);
    const tableB = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='b'").get();
    expect(tableB).toBeUndefined();
  });

  it('rejects duplicate versions with migration-version-conflict', async () => {
    const { db } = await makeDb();
    const dup: Migration = { version: 1, name: 'dup', up: () => {} };

    try {
      runMigrations(db, [createA, dup]);
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StateStoreError);
      expect((error as StateStoreError).code).toBe('migration-version-conflict');
      expect((error as StateStoreError).message).toContain('duplicate');
    }
  });

  it('rejects applied versions not present in the supplied list', async () => {
    const { db } = await makeDb();
    runMigrations(db, [createA, createB]);

    try {
      runMigrations(db, [createA]);
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(StateStoreError);
      expect((error as StateStoreError).code).toBe('migration-version-conflict');
      expect((error as StateStoreError).message).toContain('2');
    }
  });
});
