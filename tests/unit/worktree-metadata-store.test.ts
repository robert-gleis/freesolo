import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openStateStore } from '../../src/state-store/index.js';
import {
  openWorktreeMetadata,
  WorktreeMetadataStore,
  WorktreeNotFoundError
} from '../../src/worktree-metadata/index.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'worktree-metadata-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function openStore(dbPath: string): WorktreeMetadataStore {
  const stateStore = openStateStore({ path: dbPath });
  return new WorktreeMetadataStore(stateStore);
}

describe('WorktreeMetadataStore', () => {
  it('sets created_at and last_seen_at on first insert', async () => {
    const store = openStore(await tempDb());
    const row = store.upsert({
      path: '/tmp/wt-1',
      branch: 'issue/1',
      agentOwner: 'cursor',
      issueId: 1,
      now: '2026-06-05T10:00:00.000Z'
    });
    expect(row.createdAt).toBe('2026-06-05T10:00:00.000Z');
    expect(row.lastSeenAt).toBe('2026-06-05T10:00:00.000Z');
  });

  it('preserves created_at on upsert conflict', async () => {
    const store = openStore(await tempDb());
    store.upsert({
      path: '/tmp/wt-1',
      branch: 'issue/1',
      now: '2026-06-05T10:00:00.000Z'
    });
    const updated = store.upsert({
      path: '/tmp/wt-1',
      branch: 'issue/1-renamed',
      agentOwner: 'claude',
      issueId: 2,
      now: '2026-06-05T11:00:00.000Z'
    });
    expect(updated.createdAt).toBe('2026-06-05T10:00:00.000Z');
    expect(updated.lastSeenAt).toBe('2026-06-05T11:00:00.000Z');
    expect(updated.branch).toBe('issue/1-renamed');
  });

  it('returns null from getByPath when missing', async () => {
    const store = openStore(await tempDb());
    expect(store.getByPath('/missing')).toBeNull();
  });

  it('lists rows ordered by last_seen_at desc', async () => {
    const store = openStore(await tempDb());
    store.upsert({ path: '/a', branch: 'b1', now: '2026-06-05T09:00:00.000Z' });
    store.upsert({ path: '/b', branch: 'b2', now: '2026-06-05T11:00:00.000Z' });
    expect(store.list().map((row) => row.path)).toEqual(['/b', '/a']);
  });

  it('touch throws WorktreeNotFoundError when missing', async () => {
    const store = openStore(await tempDb());
    expect(() => store.touch('/missing')).toThrow(WorktreeNotFoundError);
  });

  it('normalizes paths via path.resolve', async () => {
    const store = openStore(await tempDb());
    store.upsert({ path: './relative/wt', branch: 'issue/1', now: '2026-06-05T10:00:00.000Z' });
    expect(store.getByPath(path.resolve('./relative/wt'))?.path).toBe(path.resolve('./relative/wt'));
  });

  it('two sequential upserts on the same path leave one row', async () => {
    const store = openStore(await tempDb());
    store.upsert({ path: '/tmp/wt-dup', branch: 'issue/1', now: '2026-06-05T10:00:00.000Z' });
    store.upsert({ path: '/tmp/wt-dup', branch: 'issue/1', now: '2026-06-05T11:00:00.000Z' });
    expect(store.list()).toHaveLength(1);
  });

  it('deleteByPath removes an existing row and returns true', async () => {
    const store = openStore(await tempDb());
    store.upsert({ path: '/tmp/delete-me', branch: 'issue/1', now: '2026-06-05T10:00:00.000Z' });
    expect(store.deleteByPath('/tmp/delete-me')).toBe(true);
    expect(store.getByPath('/tmp/delete-me')).toBeNull();
  });

  it('deleteByPath returns false when the row is missing', async () => {
    const store = openStore(await tempDb());
    expect(store.deleteByPath('/missing')).toBe(false);
  });
});

describe('metadata survives restart', () => {
  it('round-trips upsert through a closed and reopened file database', async () => {
    const dbPath = await tempDb();

    const first = openWorktreeMetadata({ path: dbPath });
    first.store.upsert({
      path: '/tmp/persisted-wt',
      branch: 'issue/28',
      agentOwner: 'cursor',
      issueId: 28,
      now: '2026-06-05T10:00:00.000Z'
    });
    first.close();

    const second = openWorktreeMetadata({ path: dbPath });
    const row = second.store.getByPath('/tmp/persisted-wt');
    expect(row?.branch).toBe('issue/28');
    expect(row?.issueId).toBe(28);
    second.close();
  });
});
