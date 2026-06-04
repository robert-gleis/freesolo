import { describe, expect, it } from 'vitest';

import { InMemoryWorktreeManager } from '../../src/worktrees/in-memory.js';
import { InMemoryWorktreePlacement, type WorktreePlacement } from '../../src/worktrees/placement.js';
import {
  WorktreeManagerError,
  type WorktreeIntent,
  type WorktreeLocation,
  type WorktreeOwner
} from '../../src/worktrees/types.js';

function makeClock(times: string[]): () => Date {
  const dates = times.map((iso) => new Date(iso));
  let i = 0;
  return () => {
    const result = dates[Math.min(i, dates.length - 1)];
    i += 1;
    return result;
  };
}

function makeIdFactory(prefix = 'wt'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

describe('InMemoryWorktreeManager.acquire', () => {
  it('records a fresh worktree for a new owner', async () => {
    const placement = new InMemoryWorktreePlacement();
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };
    const intent: WorktreeIntent = { branchName: 'feature/team-42', issueNumber: 42 };

    const record = await manager.acquire({ owner, intent });

    expect(record.id).toBe('wt-1');
    expect(record.owner).toEqual(owner);
    expect(record.location).toEqual({ path: '/inmem/feature/team-42', branchName: 'feature/team-42' });
    expect(record.issueNumber).toBe(42);
    expect(record.createdAt.toISOString()).toBe('2026-06-04T10:00:00.000Z');
    expect(record.lastSeenAt.toISOString()).toBe('2026-06-04T10:00:00.000Z');
  });

  it('stores issueNumber as null when intent omits it for non-issue owners', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'agent', id: 'agent-7' },
      intent: { branchName: 'feature/agent-7' }
    });

    expect(record.issueNumber).toBeNull();
  });

  it('requires intent.issueNumber to match owner.id when owner.kind is issue', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(
      manager.acquire({
        owner: { kind: 'issue', id: '19' },
        intent: { branchName: 'issue/19' }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'invalid-intent',
      message: expect.stringMatching(/missing/)
    } satisfies Partial<WorktreeManagerError>);

    await expect(
      manager.acquire({
        owner: { kind: 'issue', id: '19' },
        intent: { branchName: 'issue/19', issueNumber: 20 }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'invalid-intent'
    } satisfies Partial<WorktreeManagerError>);
  });

  it('rejects an issue owner.id that does not parse as a positive integer', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(
      manager.acquire({
        owner: { kind: 'issue', id: 'abc' },
        intent: { branchName: 'issue/abc', issueNumber: 1 }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'invalid-intent'
    } satisfies Partial<WorktreeManagerError>);

    await expect(
      manager.acquire({
        owner: { kind: 'issue', id: '' },
        intent: { branchName: 'issue/0', issueNumber: 0 }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'invalid-intent'
    } satisfies Partial<WorktreeManagerError>);

    await expect(
      manager.acquire({
        owner: { kind: 'issue', id: '0' },
        intent: { branchName: 'issue/0', issueNumber: 0 }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'invalid-intent'
    } satisfies Partial<WorktreeManagerError>);
  });

  it('treats a one-sided suggestedPath (one undefined, the other set) as a different intent (strict equality)', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z'])
    });

    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };

    await manager.acquire({
      owner,
      intent: { branchName: 'feature/x' }
    });

    await expect(
      manager.acquire({
        owner,
        intent: { branchName: 'feature/x', suggestedPath: '/foo' }
      })
    ).rejects.toMatchObject({ code: 'owner-already-acquired' });
  });

  it('is idempotent on same-intent re-acquire: same record, lastSeenAt refreshed, placement.ensure once', async () => {
    const ensureCalls: WorktreeIntent[] = [];
    const placement: WorktreePlacement = {
      ensure: async (intent) => {
        ensureCalls.push(intent);
        return { path: '/p/issue/19', branchName: 'issue/19' };
      },
      list: async () => [],
      remove: async () => {}
    };

    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z'])
    });

    const owner: WorktreeOwner = { kind: 'issue', id: '19' };
    const intent: WorktreeIntent = { branchName: 'issue/19', issueNumber: 19 };

    const first = await manager.acquire({ owner, intent });
    const second = await manager.acquire({ owner, intent });

    expect(second.id).toBe(first.id);
    expect(second.createdAt.toISOString()).toBe('2026-06-04T10:00:00.000Z');
    expect(second.lastSeenAt.toISOString()).toBe('2026-06-04T11:00:00.000Z');
    expect(ensureCalls).toHaveLength(1);
  });

  it('throws owner-already-acquired when the same owner re-acquires with a different intent', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z'])
    });

    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };

    await manager.acquire({ owner, intent: { branchName: 'feature/team-42-a' } });

    await expect(
      manager.acquire({ owner, intent: { branchName: 'feature/team-42-b' } })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'owner-already-acquired'
    } satisfies Partial<WorktreeManagerError>);
  });

  it('treats differing optional suggestedPath as a different intent (collides)', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z'])
    });

    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };

    await manager.acquire({
      owner,
      intent: { branchName: 'feature/x', suggestedPath: '/a' }
    });

    await expect(
      manager.acquire({
        owner,
        intent: { branchName: 'feature/x', suggestedPath: '/b' }
      })
    ).rejects.toMatchObject({ code: 'owner-already-acquired' });
  });

  it('wraps a placement failure as placement-failed and leaves the registry empty', async () => {
    const placement: WorktreePlacement = {
      ensure: async () => {
        throw new Error('disk full');
      },
      list: async () => [],
      remove: async () => {}
    };

    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(
      manager.acquire({
        owner: { kind: 'team', id: 'team-42' },
        intent: { branchName: 'feature/x' }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'placement-failed',
      message: expect.stringContaining('disk full')
    } satisfies Partial<WorktreeManagerError>);

    expect(await manager.list()).toEqual([]);
    expect(await manager.findByOwner({ kind: 'team', id: 'team-42' })).toBeNull();
  });
});

describe('InMemoryWorktreeManager.release', () => {
  it('removes the record from the registry without disk side effects by default', async () => {
    const removeCalls: WorktreeLocation[] = [];
    const placement: WorktreePlacement = {
      ensure: async (intent) => ({ path: `/p/${intent.branchName}`, branchName: intent.branchName }),
      list: async () => [],
      remove: async (loc) => {
        removeCalls.push(loc);
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };
    const record = await manager.acquire({ owner, intent: { branchName: 'feature/x' } });

    await manager.release({ id: record.id });

    expect(await manager.get(record.id)).toBeNull();
    expect(await manager.findByOwner(owner)).toBeNull();
    expect(removeCalls).toEqual([]);
  });

  it('asks the placement to remove the location when deleteOnDisk is true', async () => {
    const removeCalls: WorktreeLocation[] = [];
    const placement: WorktreePlacement = {
      ensure: async (intent) => ({ path: `/p/${intent.branchName}`, branchName: intent.branchName }),
      list: async () => [],
      remove: async (loc) => {
        removeCalls.push(loc);
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 'team-42' },
      intent: { branchName: 'feature/x' }
    });

    await manager.release({ id: record.id, deleteOnDisk: true });

    expect(removeCalls).toEqual([{ path: '/p/feature/x', branchName: 'feature/x' }]);
    expect(await manager.get(record.id)).toBeNull();
  });

  it('is a no-op for an unknown id and does not call placement.remove', async () => {
    const removeCalls: WorktreeLocation[] = [];
    const placement: WorktreePlacement = {
      ensure: async (intent) => ({ path: `/p/${intent.branchName}`, branchName: intent.branchName }),
      list: async () => [],
      remove: async (loc) => {
        removeCalls.push(loc);
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(manager.release({ id: 'wt-does-not-exist' })).resolves.toBeUndefined();
    await expect(manager.release({ id: 'wt-does-not-exist', deleteOnDisk: true })).resolves.toBeUndefined();
    expect(removeCalls).toHaveLength(0);
  });

  it('is a no-op when called twice for the same id (safe to retry)', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 'team-42' },
      intent: { branchName: 'feature/x' }
    });

    await manager.release({ id: record.id });
    await expect(manager.release({ id: record.id })).resolves.toBeUndefined();
  });

  it('propagates placement.remove errors unchanged and leaves the record in place', async () => {
    const placement: WorktreePlacement = {
      ensure: async (intent) => ({ path: `/p/${intent.branchName}`, branchName: intent.branchName }),
      list: async () => [],
      remove: async () => {
        throw new Error('rm: permission denied');
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 'team-42' },
      intent: { branchName: 'feature/x' }
    });

    await expect(manager.release({ id: record.id, deleteOnDisk: true })).rejects.toMatchObject({
      message: 'rm: permission denied'
    });

    expect(await manager.get(record.id)).not.toBeNull();
  });

  it('allows acquire to reuse the same owner after release', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock([
        '2026-06-04T10:00:00.000Z',
        '2026-06-04T11:00:00.000Z'
      ])
    });

    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };

    const first = await manager.acquire({ owner, intent: { branchName: 'feature/a' } });
    await manager.release({ id: first.id });

    const second = await manager.acquire({ owner, intent: { branchName: 'feature/b' } });

    expect(second.id).not.toBe(first.id);
    expect(second.location.branchName).toBe('feature/b');
  });
});

describe('InMemoryWorktreeManager.get / findByOwner / list', () => {
  it('returns null and empty array before any acquire', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    expect(await manager.get('wt-1')).toBeNull();
    expect(await manager.findByOwner({ kind: 'team', id: 'team-42' })).toBeNull();
    expect(await manager.list()).toEqual([]);
  });

  it('returns every active record across multiple owner kinds', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock([
        '2026-06-04T10:00:00.000Z',
        '2026-06-04T10:05:00.000Z',
        '2026-06-04T10:10:00.000Z'
      ])
    });

    const r1 = await manager.acquire({
      owner: { kind: 'team', id: 'team-42' },
      intent: { branchName: 'feature/team-42' }
    });
    const r2 = await manager.acquire({
      owner: { kind: 'agent', id: 'agent-7' },
      intent: { branchName: 'feature/agent-7' }
    });
    const r3 = await manager.acquire({
      owner: { kind: 'issue', id: '19' },
      intent: { branchName: 'issue/19', issueNumber: 19 }
    });

    const ids = (await manager.list()).map((rec) => rec.id).sort();
    expect(ids).toEqual([r1.id, r2.id, r3.id].sort());

    expect(await manager.findByOwner({ kind: 'agent', id: 'agent-7' })).toEqual(r2);
    expect(await manager.findByOwner({ kind: 'issue', id: '19' })).toEqual(r3);
    expect(await manager.findByOwner({ kind: 'team', id: 'team-99' })).toBeNull();
  });
});

describe('InMemoryWorktreeManager.touch', () => {
  it('refreshes lastSeenAt for a known id', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T11:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 'team-42' },
      intent: { branchName: 'feature/x' }
    });

    await manager.touch(record.id);

    const refreshed = await manager.get(record.id);
    expect(refreshed?.lastSeenAt.toISOString()).toBe('2026-06-04T11:00:00.000Z');
  });

  it('honors an explicit now argument when provided', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 'team-42' },
      intent: { branchName: 'feature/x' }
    });

    await manager.touch(record.id, new Date('2026-06-04T20:00:00.000Z'));

    const refreshed = await manager.get(record.id);
    expect(refreshed?.lastSeenAt.toISOString()).toBe('2026-06-04T20:00:00.000Z');
  });

  it('is a no-op for an unknown id', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(manager.touch('wt-missing')).resolves.toBeUndefined();
  });

  it('is a no-op for an unknown id even with an explicit now', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(
      manager.touch('wt-missing', new Date('2026-06-04T20:00:00.000Z'))
    ).resolves.toBeUndefined();
  });
});

describe('InMemoryWorktreeManager.findOrphans', () => {
  it('returns an empty orphan list when registry and placement agree', async () => {
    const manager = new InMemoryWorktreeManager({
      placement: new InMemoryWorktreePlacement(),
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T10:30:00.000Z'])
    });

    await manager.acquire({ owner: { kind: 'team', id: 'team-1' }, intent: { branchName: 'feature/a' } });

    const report = await manager.findOrphans();

    expect(report.orphans).toEqual([]);
    expect(report.scannedAt.toISOString()).toBe('2026-06-04T10:30:00.000Z');
  });

  it('reports a dangling-record when the recorded path is gone from disk', async () => {
    const placement = new InMemoryWorktreePlacement();
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z', '2026-06-04T10:30:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 'team-1' },
      intent: { branchName: 'feature/a' }
    });
    await placement.remove(record.location);

    const report = await manager.findOrphans();

    expect(report.orphans).toHaveLength(1);
    expect(report.orphans[0]).toEqual({ kind: 'dangling-record', record });
    expect(report.scannedAt.toISOString()).toBe('2026-06-04T10:30:00.000Z');
  });

  it('reports an untracked-location when disk holds a worktree the manager never recorded', async () => {
    const placement = new InMemoryWorktreePlacement();
    await placement.ensure({ branchName: 'random/orphan' });

    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const report = await manager.findOrphans();

    expect(report.orphans).toHaveLength(1);
    expect(report.orphans[0]).toEqual({
      kind: 'untracked-location',
      location: { path: '/inmem/random/orphan', branchName: 'random/orphan' }
    });
    expect(report.scannedAt.toISOString()).toBe('2026-06-04T10:00:00.000Z');
  });

  it('returns dangling-record orphans before untracked-location orphans, each block sorted stably', async () => {
    const placement = new InMemoryWorktreePlacement();
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock([
        '2026-06-04T10:00:00.000Z',
        '2026-06-04T10:01:00.000Z',
        '2026-06-04T11:00:00.000Z'
      ])
    });

    const rA = await manager.acquire({
      owner: { kind: 'team', id: 't-A' },
      intent: { branchName: 'feature/A' }
    });
    const rB = await manager.acquire({
      owner: { kind: 'team', id: 't-B' },
      intent: { branchName: 'feature/B' }
    });
    await placement.remove(rA.location);
    await placement.remove(rB.location);

    await placement.ensure({ branchName: 'untracked/zebra' });
    await placement.ensure({ branchName: 'untracked/alpha' });

    const report = await manager.findOrphans();

    expect(report.orphans).toEqual([
      { kind: 'dangling-record', record: rA },
      { kind: 'dangling-record', record: rB },
      { kind: 'untracked-location', location: { path: '/inmem/untracked/alpha', branchName: 'untracked/alpha' } },
      { kind: 'untracked-location', location: { path: '/inmem/untracked/zebra', branchName: 'untracked/zebra' } }
    ]);
    expect(report.scannedAt.toISOString()).toBe('2026-06-04T11:00:00.000Z');
  });

  it('falls back to id-lex order when two dangling records share createdAt', async () => {
    const placement = new InMemoryWorktreePlacement();
    const fixedNow = '2026-06-04T10:00:00.000Z';
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock([fixedNow, fixedNow, '2026-06-04T11:00:00.000Z'])
    });

    const r1 = await manager.acquire({
      owner: { kind: 'team', id: 't-1' },
      intent: { branchName: 'feature/a' }
    });
    const r2 = await manager.acquire({
      owner: { kind: 'team', id: 't-2' },
      intent: { branchName: 'feature/b' }
    });

    expect(r1.createdAt.toISOString()).toBe(r2.createdAt.toISOString());

    await placement.remove(r1.location);
    await placement.remove(r2.location);

    const report = await manager.findOrphans();

    expect(report.orphans).toEqual([
      { kind: 'dangling-record', record: r1 },
      { kind: 'dangling-record', record: r2 }
    ]);
    expect(report.scannedAt.toISOString()).toBe('2026-06-04T11:00:00.000Z');
  });
});

describe('InMemoryWorktreeManager.reap', () => {
  it('removes a dangling-record from the registry without touching placement', async () => {
    const placement = new InMemoryWorktreePlacement();
    let removeCalls = 0;
    const wrapped: WorktreePlacement = {
      ensure: placement.ensure.bind(placement),
      list: placement.list.bind(placement),
      remove: async (loc) => {
        removeCalls += 1;
        await placement.remove(loc);
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement: wrapped,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 't-1' },
      intent: { branchName: 'feature/a' }
    });
    await wrapped.remove(record.location);
    removeCalls = 0;

    await manager.reap({ kind: 'dangling-record', record });

    expect(await manager.get(record.id)).toBeNull();
    expect(removeCalls).toBe(0);
  });

  it('asks the placement to remove an untracked-location and is idempotent on re-reap', async () => {
    const placement = new InMemoryWorktreePlacement();
    const removeCalls: WorktreeLocation[] = [];
    const wrapped: WorktreePlacement = {
      ensure: placement.ensure.bind(placement),
      list: placement.list.bind(placement),
      remove: async (loc) => {
        removeCalls.push(loc);
        await placement.remove(loc);
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement: wrapped,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await wrapped.ensure({ branchName: 'random/orphan' });
    const location: WorktreeLocation = { path: '/inmem/random/orphan', branchName: 'random/orphan' };

    await manager.reap({ kind: 'untracked-location', location });
    await manager.reap({ kind: 'untracked-location', location });

    expect(removeCalls).toHaveLength(2);
    expect(await placement.list()).toEqual([]);
  });

  it('wraps a placement.remove failure as reap-failed', async () => {
    const placement: WorktreePlacement = {
      ensure: async (intent) => ({ path: `/p/${intent.branchName}`, branchName: intent.branchName }),
      list: async () => [{ path: '/p/random/orphan', branchName: 'random/orphan' }],
      remove: async () => {
        throw new Error('rm: permission denied');
      }
    };
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    await expect(
      manager.reap({
        kind: 'untracked-location',
        location: { path: '/p/random/orphan', branchName: 'random/orphan' }
      })
    ).rejects.toMatchObject({
      name: 'WorktreeManagerError',
      code: 'reap-failed',
      message: expect.stringContaining('rm: permission denied')
    } satisfies Partial<WorktreeManagerError>);
  });

  it('re-reaping a dangling-record whose id is already gone is a silent no-op', async () => {
    const placement = new InMemoryWorktreePlacement();
    const manager = new InMemoryWorktreeManager({
      placement,
      idFactory: makeIdFactory(),
      now: makeClock(['2026-06-04T10:00:00.000Z'])
    });

    const record = await manager.acquire({
      owner: { kind: 'team', id: 't-1' },
      intent: { branchName: 'feature/a' }
    });
    await placement.remove(record.location);

    await manager.reap({ kind: 'dangling-record', record });
    await expect(manager.reap({ kind: 'dangling-record', record })).resolves.toBeUndefined();
  });
});
