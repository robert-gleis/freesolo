import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openStateDb, type StateDb } from '../../src/state/db.js';
import { getCursor, listPending } from '../../src/state/watcher-store.js';
import { runWatchCycle, runWatchLoop } from '../../src/watcher/runner.js';
import type { TickResult } from '../../src/workflow/engine.js';

const repo = { owner: 'acme', repo: 'widgets' };
let db: StateDb;
const tempDbs: string[] = [];

beforeEach(async () => {
  const dbPath = path.join(os.tmpdir(), `issueflow-runner-${Date.now()}.db`);
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

describe('runWatchCycle', () => {
  it('enqueues polled issues, ticks engine, advances cursor', async () => {
    const tickResults: TickResult[] = [];
    const poll = vi.fn().mockResolvedValue({
      issues: [{ number: 42, updatedAt: '2026-06-02T10:00:00Z' }],
      rateLimited: false
    });

    const result = await runWatchCycle({
      db,
      repo,
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll,
      tick: async ({ issueNumber }) => {
        const tickResult: TickResult = {
          issueNumber,
          fromState: 'triaged',
          toState: 'triaged',
          action: { kind: 'wait', reason: 'agent owns work' }
        };
        tickResults.push(tickResult);
        return tickResult;
      },
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(poll).toHaveBeenCalledWith('2026-06-01T00:00:00Z');
    expect(result.failed).toBe(0);
    expect(tickResults).toHaveLength(1);
    expect(getCursor(db, repo)).toBe('2026-06-02T10:00:00Z');
    expect(listPending(db, repo)).toHaveLength(0);
  });

  it('passes first-run now() cursor to poll when no override or stored cursor', async () => {
    const poll = vi.fn().mockResolvedValue({ issues: [], rateLimited: false });
    const fixedNow = new Date('2026-06-02T12:00:00Z');

    await runWatchCycle({
      db,
      repo,
      triggerLabel: 'state:triaged',
      poll,
      tick: async () => {
        throw new Error('should not tick');
      },
      now: () => fixedNow
    });

    expect(poll).toHaveBeenCalledWith('2026-06-02T12:00:00.000Z');
  });

  it('skips drain when rate limited', async () => {
    const result = await runWatchCycle({
      db,
      repo,
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll: async () => ({ issues: [], rateLimited: true }),
      tick: async () => {
        throw new Error('should not tick');
      },
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(result.rateLimited).toBe(true);
    expect(result.enqueued).toBe(0);
  });

  it('surfaces poll errors without advancing cursor', async () => {
    const result = await runWatchCycle({
      db,
      repo,
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll: async () => ({ issues: [], rateLimited: false, error: 'HTTP 401: Bad credentials' }),
      tick: async () => {
        throw new Error('should not tick');
      },
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(result.pollError).toBe('HTTP 401: Bad credentials');
    expect(result.enqueued).toBe(0);
    expect(getCursor(db, repo)).toBeNull();
  });

  it('marks queue row done on no-state engine refusal', async () => {
    const result = await runWatchCycle({
      db,
      repo,
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll: async () => ({
        issues: [{ number: 99, updatedAt: '2026-06-02T10:00:00Z' }],
        rateLimited: false
      }),
      tick: async ({ issueNumber }) => ({
        issueNumber,
        fromState: null,
        toState: null,
        action: { kind: 'refuse', reason: 'issue has no state label' },
        refused: { code: 'no-state', reason: 'issue has no state label' }
      }),
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(result.failed).toBe(0);
    expect(result.processed).toBe(1);
    expect(listPending(db, repo)).toHaveLength(0);
  });
});

describe('runWatchLoop', () => {
  it('exits after in-flight cycle when abort signal fires', async () => {
    const controller = new AbortController();
    let cycles = 0;

    const loopPromise = runWatchLoop({
      db,
      repo,
      triggerLabel: 'state:triaged',
      intervalMs: 60_000,
      poll: async () => {
        cycles += 1;
        if (cycles === 1) {
          controller.abort();
        }
        return { issues: [], rateLimited: false };
      },
      tick: async () => {
        throw new Error('should not tick');
      },
      sleep: async () => {},
      signal: controller.signal,
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    await loopPromise;
    expect(cycles).toBe(1);
  });

  it('applies exponential backoff on rate limit', async () => {
    const sleeps: number[] = [];
    let pollCount = 0;
    const controller = new AbortController();

    const loopPromise = runWatchLoop({
      db,
      repo,
      triggerLabel: 'state:triaged',
      intervalMs: 30_000,
      poll: async () => {
        pollCount += 1;
        if (pollCount >= 3) {
          controller.abort();
        }
        return { issues: [], rateLimited: true };
      },
      tick: async () => {
        throw new Error('should not tick');
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      signal: controller.signal,
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    await loopPromise;
    expect(sleeps).toEqual([60_000, 120_000]);
  });
});
