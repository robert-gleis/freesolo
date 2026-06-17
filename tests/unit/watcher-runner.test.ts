import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openStateDb, type StateDb } from '../../src/state/db.js';
import {
  getCursor,
  listPending,
  markIntakeAccepted,
  markIntakeIgnored
} from '../../src/state/watcher-store.js';
import { runWatchCycle, runWatchLoop } from '../../src/watcher/runner.js';
import type { TickResult } from '../../src/workflow/engine.js';

const repo = { owner: 'acme', repo: 'widgets' };
const assignedIssue = {
  number: 42,
  title: 'Docker Runner',
  updatedAt: '2026-06-02T10:00:00Z',
  labels: ['enhancement'],
  assignees: ['octocat']
};
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
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll,
      readState: async () => 'triaged',
      initializeState: async () => {},
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
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
      triggerLabel: 'state:triaged',
      poll,
      readState: async () => 'triaged',
      initializeState: async () => {},
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
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll: async () => ({ issues: [], rateLimited: true }),
      readState: async () => 'triaged',
      initializeState: async () => {},
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
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll: async () => ({ issues: [], rateLimited: false, error: 'HTTP 401: Bad credentials' }),
      readState: async () => 'triaged',
      initializeState: async () => {},
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
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
      sinceOverride: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      poll: async () => ({
        issues: [{ number: 99, updatedAt: '2026-06-02T10:00:00Z' }],
        rateLimited: false
      }),
      readState: async () => 'triaged',
      initializeState: async () => {},
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

  it('confirms unseen assigned issue and initializes local state before ticking', async () => {
    const prompts: string[] = [];
    const initialized: Array<{ issueNumber: number; state: string }> = [];
    const ticks: number[] = [];

    const result = await runWatchCycle({
      db,
      repo,
      source: 'assigned-to-me',
      intakeMode: 'confirm',
      initialState: 'triaged',
      triggerLabel: 'triaged',
      poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
      confirmIntake: async (issue) => {
        prompts.push(issue.title);
        return true;
      },
      readState: async () => null,
      initializeState: async ({ issueNumber, initialState }) => {
        initialized.push({ issueNumber, state: initialState });
      },
      tick: async ({ issueNumber }) => {
        ticks.push(issueNumber);
        return {
          issueNumber,
          fromState: 'triaged',
          toState: 'triaged',
          action: { kind: 'wait', reason: 'agent owns work' }
        };
      },
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(prompts).toEqual(['Docker Runner']);
    expect(initialized).toEqual([{ issueNumber: 42, state: 'triaged' }]);
    expect(ticks).toEqual([42]);
    expect(result.enqueued).toBe(1);
    expect(result.processed).toBe(1);
  });

  it('records ignored decision when confirm returns false', async () => {
    const result = await runWatchCycle({
      db,
      repo,
      source: 'assigned-to-me',
      intakeMode: 'confirm',
      initialState: 'triaged',
      triggerLabel: 'triaged',
      poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
      confirmIntake: async () => false,
      readState: async () => null,
      initializeState: async () => {
        throw new Error('should not initialize');
      },
      tick: async () => {
        throw new Error('should not tick');
      },
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(result.enqueued).toBe(0);
    expect(result.processed).toBe(0);
  });

  it('auto intake accepts without prompting', async () => {
    const initialized: number[] = [];

    await runWatchCycle({
      db,
      repo,
      source: 'assigned-to-me',
      intakeMode: 'auto',
      initialState: 'triaged',
      triggerLabel: 'triaged',
      poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
      confirmIntake: async () => {
        throw new Error('should not prompt');
      },
      readState: async () => null,
      initializeState: async ({ issueNumber }) => {
        initialized.push(issueNumber);
      },
      tick: async ({ issueNumber }) => ({
        issueNumber,
        fromState: 'triaged',
        toState: 'triaged',
        action: { kind: 'wait', reason: 'agent owns work' }
      }),
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(initialized).toEqual([42]);
  });

  it('fails clearly when accepted intake has no local state', async () => {
    markIntakeAccepted(db, repo, assignedIssue.number, assignedIssue.updatedAt);

    await expect(
      runWatchCycle({
        db,
        repo,
        source: 'assigned-to-me',
        intakeMode: 'auto',
        initialState: 'triaged',
        triggerLabel: 'triaged',
        poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
        readState: async () => null,
        initializeState: async () => {
          throw new Error('should not initialize');
        },
        tick: async () => {
          throw new Error('should not tick');
        },
        now: () => new Date('2026-06-02T12:00:00Z')
      })
    ).rejects.toThrow(/accepted by watcher intake but has no local workflow state/);
  });

  it('skips previously ignored intake decisions without prompting', async () => {
    markIntakeIgnored(db, repo, assignedIssue.number, assignedIssue.updatedAt);

    const result = await runWatchCycle({
      db,
      repo,
      source: 'assigned-to-me',
      intakeMode: 'confirm',
      initialState: 'triaged',
      triggerLabel: 'triaged',
      poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
      confirmIntake: async () => {
        throw new Error('should not prompt');
      },
      readState: async () => {
        throw new Error('should not read state');
      },
      initializeState: async () => {
        throw new Error('should not initialize');
      },
      tick: async () => {
        throw new Error('should not tick');
      },
      now: () => new Date('2026-06-02T12:00:00Z')
    });

    expect(result.enqueued).toBe(0);
    expect(result.processed).toBe(0);
  });

  it('fails clearly when confirm intake has no prompt callback', async () => {
    await expect(
      runWatchCycle({
        db,
        repo,
        source: 'assigned-to-me',
        intakeMode: 'confirm',
        initialState: 'triaged',
        triggerLabel: 'triaged',
        poll: async () => ({ issues: [assignedIssue], rateLimited: false }),
        readState: async () => null,
        initializeState: async () => {
          throw new Error('should not initialize');
        },
        tick: async () => {
          throw new Error('should not tick');
        },
        now: () => new Date('2026-06-02T12:00:00Z')
      })
    ).rejects.toThrow(/watcher intake confirmation requires an interactive prompt/);
  });
});

describe('runWatchLoop', () => {
  it('exits after in-flight cycle when abort signal fires', async () => {
    const controller = new AbortController();
    let cycles = 0;

    const loopPromise = runWatchLoop({
      db,
      repo,
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
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
      readState: async () => 'triaged',
      initializeState: async () => {},
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
      source: 'label',
      intakeMode: 'auto',
      initialState: 'triaged',
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
      readState: async () => 'triaged',
      initializeState: async () => {},
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
