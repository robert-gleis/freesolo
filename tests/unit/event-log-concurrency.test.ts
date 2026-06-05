import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/index.js';
import { openStateStore } from '../../src/state-store/index.js';

const tempDirs: string[] = [];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerScript = path.resolve(__dirname, '..', 'fixtures', 'event-log-concurrent-writer.mjs');

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-log-concurrency-'));
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
        EVENT_LOG_DB_PATH: dbPath,
        EVENT_LOG_ROW_COUNT: String(rowCount)
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

describe('event-log concurrent writers', () => {
  it('lets multiple processes append without dropping writes', async () => {
    const dbPath = await tempDb();
    openEventLog({ path: dbPath }).close();

    const workerCount = 4;
    const rowsPerWorker = 25;

    const reports = await Promise.all(
      Array.from({ length: workerCount }, () => runWorker(dbPath, rowsPerWorker))
    );

    expect(reports).toHaveLength(workerCount);
    for (const report of reports) {
      expect(report.written).toBe(rowsPerWorker);
    }

    const verifyStore = openStateStore({ path: dbPath });
    try {
      const totalCount = (verifyStore.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;
      expect(totalCount).toBe(workerCount * rowsPerWorker);

      const perPid = verifyStore
        .prepare('SELECT agent_id AS pid, COUNT(*) AS c FROM events GROUP BY agent_id')
        .all() as Array<{ pid: string; c: number }>;
      expect(perPid).toHaveLength(workerCount);
      for (const { c } of perPid) {
        expect(c).toBe(rowsPerWorker);
      }

      const ids = (verifyStore.prepare('SELECT id FROM events ORDER BY id').all() as Array<{ id: number }>).map(
        (row) => row.id
      );
      expect(new Set(ids).size).toBe(ids.length);
      for (let i = 1; i < ids.length; i++) {
        expect(ids[i]).toBeGreaterThan(ids[i - 1]);
      }
    } finally {
      verifyStore.close();
    }
  }, 30000);
});
