import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openStateStore } from '../../src/state-store/index.js';
import { openAgentLogStore } from '../../src/replay/log-store.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-log-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('openAgentLogStore', () => {
  it('captures and reads a snapshot by id', async () => {
    const store = openAgentLogStore({ path: await tempDb() });
    const row = store.capture({
      agentId: 'agent-1',
      issueId: 32,
      stdout: 'hello',
      stderr: 'warn',
      truncated: false
    });
    expect(row.id).toBeGreaterThan(0);
    const read = store.read(row.id);
    expect(read?.stdout).toBe('hello');
    expect(read?.stderr).toBe('warn');
    store.close();
  });

  it('round-trips truncated flag', async () => {
    const store = openAgentLogStore({ path: await tempDb() });
    const row = store.capture({
      agentId: 'a',
      issueId: 32,
      stdout: '',
      stderr: '',
      truncated: true
    });
    expect(store.read(row.id)?.truncated).toBe(true);
    store.close();
  });

  it('applies migration version 4 with agent_log_snapshots table', async () => {
    const dbPath = await tempDb();
    openAgentLogStore({ path: dbPath }).close();
    const store = openStateStore({ path: dbPath });
    const versions = (
      store.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
        version: number;
      }>
    ).map((row) => row.version);
    expect(versions).toContain(4);
    const columns = store
      .prepare('PRAGMA table_info(agent_log_snapshots)')
      .all() as Array<{ name: string }>;
    expect(columns.map((c) => c.name)).toContain('truncated');
    store.close();
  });
});
