import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/store.js';
import { openStateStore } from '../../src/state-store/index.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-log-migration-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('events migration', () => {
  it('creates the events table and indices on first open', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    log.close();

    const store = openStateStore({ path: dbPath });
    try {
      const tables = store.unsafe
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);

      const indices = store.unsafe
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events'")
        .all() as Array<{ name: string }>;
      expect(indices.map((i) => i.name).sort()).toEqual([
        'idx_events_agent_id',
        'idx_events_event_type',
        'idx_events_issue_id'
      ]);
    } finally {
      store.close();
    }
  });

  it('is idempotent on second open', async () => {
    const dbPath = await tempDb();
    openEventLog({ path: dbPath }).close();
    const second = openEventLog({ path: dbPath });
    expect(second.path).toBe(dbPath);
    second.close();
  });
});
