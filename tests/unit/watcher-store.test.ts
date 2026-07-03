import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openStateDb, type StateDb } from '../../src/state/db.js';
import {
  enqueueIssue,
  getCursor,
  isIssueIgnored,
  listPending,
  markIssueIgnored,
  markDone,
  markFailed,
  markProcessing,
  recoverStaleProcessing,
  setCursor
} from '../../src/state/watcher-store.js';
import type { RepoRef } from '../../src/core/types.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
let db: StateDb;
const tempDbs: string[] = [];

beforeEach(async () => {
  const dbPath = path.join(os.tmpdir(), `issueflow-store-${Date.now()}.db`);
  tempDbs.push(dbPath);
  db = await openStateDb(dbPath);
});

afterEach(async () => {
  db.close();
  for (const dbPath of tempDbs) {
    await fs.unlink(dbPath).catch(() => {});
    await fs.unlink(`${dbPath}-wal`).catch(() => {});
    await fs.unlink(`${dbPath}-shm`).catch(() => {});
  }
  tempDbs.length = 0;
});

describe('watcher-store', () => {
  it('getCursor returns null when unset', () => {
    expect(getCursor(db, repo)).toBeNull();
  });

  it('setCursor round-trips', () => {
    setCursor(db, repo, '2026-06-01T12:00:00.000Z');
    expect(getCursor(db, repo)).toBe('2026-06-01T12:00:00.000Z');
  });

  it('enqueueIssue is idempotent', () => {
    expect(enqueueIssue(db, repo, 42, '2026-06-01T12:00:00.000Z')).toBe(true);
    expect(enqueueIssue(db, repo, 42, '2026-06-01T12:00:00.000Z')).toBe(false);
    expect(listPending(db, repo)).toHaveLength(1);
  });

  it('markProcessing then markDone updates status', () => {
    enqueueIssue(db, repo, 7, '2026-06-01T13:00:00.000Z');
    const [row] = listPending(db, repo);
    markProcessing(db, row.id);
    markDone(db, row.id);
    expect(listPending(db, repo)).toHaveLength(0);
  });

  it('markFailed stores error', () => {
    enqueueIssue(db, repo, 8, '2026-06-01T14:00:00.000Z');
    const [row] = listPending(db, repo);
    markFailed(db, row.id, 'boom');
    expect(listPending(db, repo)).toHaveLength(0);
  });

  it('recoverStaleProcessing resets stuck processing rows to pending', () => {
    enqueueIssue(db, repo, 9, '2026-06-01T15:00:00.000Z');
    const [row] = listPending(db, repo);
    markProcessing(db, row.id);

    db.prepare('UPDATE watcher_queue SET enqueued_at = ? WHERE id = ?').run(
      new Date(Date.now() - 10 * 60_000).toISOString(),
      row.id
    );

    expect(listPending(db, repo)).toHaveLength(0);
    const recovered = recoverStaleProcessing(db, repo, 5 * 60_000);
    expect(recovered).toBe(1);
    expect(listPending(db, repo)).toHaveLength(1);
  });
});

describe('watcher ignored ledger', () => {
  it('reports false when an issue has not been ignored', () => {
    expect(isIssueIgnored(db, repo, 42)).toBe(false);
  });

  it('records an ignored issue', () => {
    markIssueIgnored(db, repo, 43);
    expect(isIssueIgnored(db, repo, 43)).toBe(true);
  });

  it('is idempotent and scoped per issue', () => {
    markIssueIgnored(db, repo, 43);
    markIssueIgnored(db, repo, 43);
    expect(isIssueIgnored(db, repo, 43)).toBe(true);
    expect(isIssueIgnored(db, repo, 44)).toBe(false);
  });

  it('scopes ignored issues per repo', () => {
    markIssueIgnored(db, repo, 43);
    expect(isIssueIgnored(db, { owner: 'other', repo: 'project' }, 43)).toBe(false);
  });

  it('persists a decided_at audit timestamp', () => {
    markIssueIgnored(db, repo, 43);
    const row = db
      .prepare(
        'SELECT decided_at FROM watcher_ignored WHERE repo_owner = ? AND repo_name = ? AND issue_number = ?'
      )
      .get(repo.owner, repo.repo, 43) as { decided_at: string };
    expect(row.decided_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
