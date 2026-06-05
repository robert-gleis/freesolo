import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { openStateStore } from '../../src/state-store/index.js';
import type { Migration } from '../../src/state-store/types.js';

const tempDirs: string[] = [];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerScript = path.resolve(__dirname, '..', 'fixtures', 'state-store-concurrent-writer.mjs');

const createTestEvents: Migration = {
  version: 2,
  name: 'create-test-events',
  up: (db) => {
    db.exec(`
      CREATE TABLE test_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        pid     INTEGER NOT NULL,
        payload TEXT    NOT NULL
      )
    `);
  }
};

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'state-store-concurrency-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

interface WorkerDone {
  type: 'done';
  pid: number;
  written: number;
}

function runWorker(dbPath: string, rowCount: number): Promise<WorkerDone> {
  return new Promise((resolve, reject) => {
    const child = fork(workerScript, {
      env: {
        ...process.env,
        STATE_STORE_DB_PATH: dbPath,
        STATE_STORE_ROW_COUNT: String(rowCount)
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    });

    let report: WorkerDone | undefined;

    child.on('message', (message: WorkerDone) => {
      if (message?.type === 'done') {
        report = message;
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0 || !report) {
        reject(new Error(`worker exited with code ${code} (report=${JSON.stringify(report)})`));
        return;
      }
      resolve(report);
    });

    child.send({ type: 'go' });
  });
}

describe('state-store concurrent writers', () => {
  it('lets multiple processes append without dropping writes', async () => {
    const dbPath = await tempDb();
    const initStore = openStateStore({
      path: dbPath,
      migrations: [{ version: 1, name: 'init', up: () => {} }, createTestEvents]
    });
    initStore.close();

    const workerCount = 4;
    const rowsPerWorker = 50;

    const reports = await Promise.all(
      Array.from({ length: workerCount }, () => runWorker(dbPath, rowsPerWorker))
    );

    expect(reports).toHaveLength(workerCount);

    const verifyStore = openStateStore({
      path: dbPath,
      migrations: [{ version: 1, name: 'init', up: () => {} }, createTestEvents]
    });

    const totalCount = (verifyStore
      .prepare('SELECT COUNT(*) AS c FROM test_events')
      .get() as { c: number }).c;
    expect(totalCount).toBe(workerCount * rowsPerWorker);

    const perPid = verifyStore
      .prepare('SELECT pid, COUNT(*) AS c FROM test_events GROUP BY pid')
      .all() as Array<{ pid: number; c: number }>;
    expect(perPid).toHaveLength(workerCount);
    for (const { c } of perPid) {
      expect(c).toBe(rowsPerWorker);
    }

    const ids = (verifyStore
      .prepare('SELECT id FROM test_events ORDER BY id')
      .all() as Array<{ id: number }>).map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }

    verifyStore.close();
  }, 30000);
});
