import { describe, expect, it } from 'vitest';

import {
  WorktreeManagerError,
  type WorktreeId,
  type WorktreeIntent,
  type WorktreeLocation,
  type WorktreeManagerErrorCode,
  type WorktreeOrphan,
  type WorktreeOrphanKind,
  type WorktreeOrphanReport,
  type WorktreeOwner,
  type WorktreeOwnerKind,
  type WorktreeRecord
} from '../../src/worktrees/types.js';

describe('WorktreeOwnerKind', () => {
  it('pins the union to agent | team | issue', () => {
    const all: WorktreeOwnerKind[] = ['agent', 'team', 'issue'];
    expect(all).toHaveLength(3);
  });
});

describe('WorktreeOrphanKind', () => {
  it('pins the union to dangling-record | untracked-location', () => {
    const all: WorktreeOrphanKind[] = ['dangling-record', 'untracked-location'];
    expect(all).toHaveLength(2);
  });
});

describe('WorktreeOwner', () => {
  it('carries kind and id', () => {
    const owner: WorktreeOwner = { kind: 'team', id: 'team-42' };
    expect(owner.kind).toBe('team');
    expect(owner.id).toBe('team-42');
  });
});

describe('WorktreeIntent', () => {
  it('requires a branch name and allows optional suggestedPath and issueNumber', () => {
    const minimal: WorktreeIntent = { branchName: 'issue/19-worktree-manager' };
    const full: WorktreeIntent = {
      branchName: 'issue/19-worktree-manager',
      suggestedPath: '/tmp/wt-19',
      issueNumber: 19
    };

    expect(minimal.branchName).toBe('issue/19-worktree-manager');
    expect(full.suggestedPath).toBe('/tmp/wt-19');
    expect(full.issueNumber).toBe(19);
  });
});

describe('WorktreeLocation', () => {
  it('carries path and branchName', () => {
    const loc: WorktreeLocation = { path: '/tmp/wt-19', branchName: 'issue/19' };
    expect(loc.path).toBe('/tmp/wt-19');
    expect(loc.branchName).toBe('issue/19');
  });
});

describe('WorktreeRecord', () => {
  it('carries id, owner, location, issueNumber, createdAt, lastSeenAt', () => {
    const record: WorktreeRecord = {
      id: 'wt-1' as WorktreeId,
      owner: { kind: 'issue', id: '19' },
      location: { path: '/tmp/wt-19', branchName: 'issue/19' },
      issueNumber: 19,
      createdAt: new Date('2026-06-04T00:00:00.000Z'),
      lastSeenAt: new Date('2026-06-04T00:00:00.000Z')
    };

    expect(record.id).toBe('wt-1');
    expect(record.issueNumber).toBe(19);
    expect(record.location.path).toBe('/tmp/wt-19');
  });

  it('allows issueNumber to be null for non-issue owners', () => {
    const record: WorktreeRecord = {
      id: 'wt-2' as WorktreeId,
      owner: { kind: 'agent', id: 'agent-7' },
      location: { path: '/tmp/wt-agent-7', branchName: 'feature/agent-7' },
      issueNumber: null,
      createdAt: new Date(),
      lastSeenAt: new Date()
    };

    expect(record.issueNumber).toBeNull();
  });
});

describe('WorktreeOrphan', () => {
  it('discriminates on kind: dangling-record carries a record', () => {
    const orphan: WorktreeOrphan = {
      kind: 'dangling-record',
      record: {
        id: 'wt-1' as WorktreeId,
        owner: { kind: 'issue', id: '19' },
        location: { path: '/tmp/gone', branchName: 'issue/19' },
        issueNumber: 19,
        createdAt: new Date(),
        lastSeenAt: new Date()
      }
    };

    expect(orphan.kind).toBe('dangling-record');
    if (orphan.kind === 'dangling-record') {
      expect(orphan.record.id).toBe('wt-1');
    }
  });

  it('discriminates on kind: untracked-location carries a location', () => {
    const orphan: WorktreeOrphan = {
      kind: 'untracked-location',
      location: { path: '/tmp/orphan', branchName: 'feature/orphan' }
    };

    expect(orphan.kind).toBe('untracked-location');
    if (orphan.kind === 'untracked-location') {
      expect(orphan.location.path).toBe('/tmp/orphan');
    }
  });
});

describe('WorktreeOrphanReport', () => {
  it('carries an orphans array and a scannedAt timestamp', () => {
    const report: WorktreeOrphanReport = { orphans: [], scannedAt: new Date() };
    expect(report.orphans).toEqual([]);
    expect(report.scannedAt).toBeInstanceOf(Date);
  });
});

describe('WorktreeManagerError', () => {
  it('is an Error subclass carrying a code', () => {
    const err = new WorktreeManagerError('owner-already-acquired', 'owner X has a different live intent');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WorktreeManagerError');
    expect(err.code).toBe('owner-already-acquired');
    expect(err.message).toBe('owner X has a different live intent');
  });

  it('supports every documented code', () => {
    const codes: WorktreeManagerErrorCode[] = [
      'owner-already-acquired',
      'placement-failed',
      'reap-failed',
      'invalid-intent'
    ];

    for (const code of codes) {
      const err = new WorktreeManagerError(code, 'msg');
      expect(err.code).toBe(code);
    }
  });
});

import * as worktreesBarrel from '../../src/worktrees/index.js';
import type { WorktreeManager as WorktreeManagerType, WorktreePlacement as WorktreePlacementType } from '../../src/worktrees/index.js';
import type { AcquireInput, ReleaseInput, WorktreeManager } from '../../src/worktrees/manager.js';

describe('WorktreeManager (structural)', () => {
  it('accepts a minimal inline implementation', async () => {
    const record: WorktreeRecord = {
      id: 'wt-1' as WorktreeId,
      owner: { kind: 'issue', id: '19' },
      location: { path: '/tmp/wt-19', branchName: 'issue/19' },
      issueNumber: 19,
      createdAt: new Date(0),
      lastSeenAt: new Date(0)
    };

    const manager: WorktreeManager = {
      acquire: async (_input: AcquireInput) => record,
      release: async (_input: ReleaseInput) => {},
      get: async () => record,
      findByOwner: async () => record,
      list: async () => [record],
      touch: async () => {},
      findOrphans: async () => ({ orphans: [], scannedAt: new Date(0) }),
      reap: async () => {}
    };

    expect(await manager.acquire({ owner: record.owner, intent: { branchName: 'issue/19' } })).toBe(record);
    expect(await manager.list()).toHaveLength(1);
    expect((await manager.findOrphans()).orphans).toEqual([]);
  });
});

describe('src/worktrees barrel re-export', () => {
  it('exposes WorktreeManagerError, InMemoryWorktreeManager, and InMemoryWorktreePlacement as values', () => {
    expect(typeof worktreesBarrel.WorktreeManagerError).toBe('function');
    expect(typeof worktreesBarrel.InMemoryWorktreeManager).toBe('function');
    expect(typeof worktreesBarrel.InMemoryWorktreePlacement).toBe('function');
  });

  it('exposes WorktreeManager as a type that InMemoryWorktreeManager satisfies', () => {
    const placement = new worktreesBarrel.InMemoryWorktreePlacement();
    const manager: WorktreeManagerType = new worktreesBarrel.InMemoryWorktreeManager({ placement });
    expect(typeof manager.acquire).toBe('function');
  });

  it('exposes WorktreePlacement as a type that InMemoryWorktreePlacement satisfies', () => {
    const placement: WorktreePlacementType = new worktreesBarrel.InMemoryWorktreePlacement();
    expect(typeof placement.ensure).toBe('function');
  });
});
