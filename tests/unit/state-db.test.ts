import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openStateDb } from '../../src/state/db.js';

const tempDbs: string[] = [];

afterEach(async () => {
  for (const dbPath of tempDbs) {
    await fs.unlink(dbPath).catch(() => {});
    await fs.unlink(`${dbPath}-wal`).catch(() => {});
    await fs.unlink(`${dbPath}-shm`).catch(() => {});
  }
  tempDbs.length = 0;
});

function tempDbPath(): string {
  const p = path.join(os.tmpdir(), `issueflow-state-${Date.now()}.db`);
  tempDbs.push(p);
  return p;
}

describe('openStateDb', () => {
  it('creates watcher tables on first open', async () => {
    const db = await openStateDb(tempDbPath());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain('schema_migrations');
    expect(tables).toContain('watcher_cursor');
    expect(tables).toContain('watcher_queue');
    db.close();
  });

  it('is idempotent on second open', async () => {
    const dbPath = tempDbPath();
    const db1 = await openStateDb(dbPath);
    db1.close();
    const db2 = await openStateDb(dbPath);
    const version = db2.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number };
    expect(version.v).toBe(1);
    db2.close();
  });

  it('enables WAL journal mode', async () => {
    const db = await openStateDb(tempDbPath());
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('wal');
    db.close();
  });
});
