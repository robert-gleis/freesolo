import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openConnection } from '../../src/state-store/connection.js';
import { StateStoreError } from '../../src/state-store/types.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-conn-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('openConnection', () => {
  it('creates missing parent directories', async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, 'nested', 'deeper', 'state.db');

    const db = openConnection(dbPath);

    expect(await fs.stat(dbPath)).toBeDefined();
    db.close();
  });

  it('enables WAL journal mode', async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, 'state.db');

    const db = openConnection(dbPath);
    const mode = db.pragma('journal_mode', { simple: true });

    expect(mode).toBe('wal');
    db.close();
  });

  it('applies the expected pragmas', async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, 'state.db');

    const db = openConnection(dbPath);

    expect(db.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });

  it('throws StateStoreError("open-failed") when the path is invalid', () => {
    // A NUL byte in the path is rejected by both fs.mkdirSync and better-sqlite3.
    expect(() => openConnection('/tmp/\x00bad/state.db')).toThrowError(StateStoreError);

    try {
      openConnection('/tmp/\x00bad/state.db');
    } catch (error) {
      expect((error as StateStoreError).code).toBe('open-failed');
    }
  });
});
