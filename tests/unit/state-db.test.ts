import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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

    expect(tables).toContain('watcher_schema_migrations');
    expect(tables).toContain('watcher_cursor');
    expect(tables).toContain('watcher_queue');
    db.close();
  });

  it('creates watcher intake table on first open', async () => {
    const db = await openStateDb(tempDbPath());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toContain('watcher_intake');
    db.close();
  });

  it('records migration version 2', async () => {
    const db = await openStateDb(tempDbPath());
    const version = db.prepare('SELECT MAX(version) AS v FROM watcher_schema_migrations').get() as { v: number };
    expect(version.v).toBe(2);
    db.close();
  });

  it('is idempotent on second open', async () => {
    const dbPath = tempDbPath();
    const db1 = await openStateDb(dbPath);
    db1.close();
    const db2 = await openStateDb(dbPath);
    const version = db2.prepare('SELECT MAX(version) AS v FROM watcher_schema_migrations').get() as { v: number };
    expect(version.v).toBe(2);
    db2.close();
  });

  it('applies watcher migrations when central schema_migrations already has versions 1 and 2', async () => {
    const dbPath = tempDbPath();
    const centralDb = new DatabaseSync(dbPath);
    centralDb.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at) VALUES
        (1, 'central-1', '2026-06-17T00:00:00.000Z'),
        (2, 'central-2', '2026-06-17T00:00:00.000Z');
    `);
    centralDb.close();

    const db = await openStateDb(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    const version = db.prepare('SELECT MAX(version) AS v FROM watcher_schema_migrations').get() as { v: number };

    expect(tables).toContain('watcher_cursor');
    expect(tables).toContain('watcher_queue');
    expect(tables).toContain('watcher_intake');
    expect(version.v).toBe(2);
    db.close();
  });

  it('enables WAL journal mode', async () => {
    const db = await openStateDb(tempDbPath());
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(row.journal_mode).toBe('wal');
    db.close();
  });
});
