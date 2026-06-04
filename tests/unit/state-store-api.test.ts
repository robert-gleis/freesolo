import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openStateStore } from '../../src/state-store/index.js';
import type { Migration } from '../../src/state-store/index.js';

const tempDirs: string[] = [];

async function tempPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-api-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const createNotes: Migration = {
  version: 2,
  name: 'create-notes',
  up: (db) => {
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
  }
};

describe('openStateStore', () => {
  it('opens the DB at the requested path and applies base + custom migrations', async () => {
    const dbPath = await tempPath();
    const store = openStateStore({ path: dbPath, migrations: [
      { version: 1, name: 'init', up: () => {} },
      createNotes
    ] });

    store.exec("INSERT INTO notes (body) VALUES ('hello')");
    const row = store.prepare('SELECT body FROM notes').get() as { body: string };

    expect(store.path).toBe(dbPath);
    expect(row.body).toBe('hello');
    store.close();
  });

  it('runs transaction(fn) and rolls back on throw', async () => {
    const dbPath = await tempPath();
    const store = openStateStore({ path: dbPath, migrations: [
      { version: 1, name: 'init', up: () => {} },
      createNotes
    ] });

    expect(() =>
      store.transaction(() => {
        store.exec("INSERT INTO notes (body) VALUES ('one')");
        throw new Error('boom');
      })
    ).toThrow('boom');

    const count = (store.prepare('SELECT COUNT(*) AS c FROM notes').get() as { c: number }).c;
    expect(count).toBe(0);
    store.close();
  });

  it('close() is idempotent', async () => {
    const dbPath = await tempPath();
    const store = openStateStore({ path: dbPath });

    expect(() => store.close()).not.toThrow();
    expect(() => store.close()).not.toThrow();
  });

  it('exposes the underlying handle via .unsafe', async () => {
    const dbPath = await tempPath();
    const store = openStateStore({ path: dbPath });

    expect(store.unsafe.open).toBe(true);
    store.close();
  });

  it('uses BASE_MIGRATIONS when no migrations are provided', async () => {
    const dbPath = await tempPath();
    const store = openStateStore({ path: dbPath });

    const versions = (store
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>).map((row) => row.version);

    expect(versions).toEqual([1]);
    store.close();
  });

  it('prepare() after close() throws StateStoreError("closed")', async () => {
    const dbPath = await tempPath();
    const store = openStateStore({ path: dbPath });
    store.close();

    try {
      store.prepare('SELECT 1');
      throw new Error('did not throw');
    } catch (error) {
      expect((error as { name?: string }).name).toBe('StateStoreError');
      expect((error as { code?: string }).code).toBe('closed');
    }
  });
});
