import { describe, expect, it } from 'vitest';

import { InMemoryWorktreePlacement, type WorktreePlacement } from '../../src/worktrees/placement.js';
import type { WorktreeIntent } from '../../src/worktrees/types.js';

describe('WorktreePlacement (structural)', () => {
  it('accepts a minimal inline implementation', async () => {
    const placement: WorktreePlacement = {
      ensure: async (intent) => ({ path: `/inline/${intent.branchName}`, branchName: intent.branchName }),
      list: async () => [],
      remove: async () => {}
    };

    const loc = await placement.ensure({ branchName: 'foo' });
    expect(loc.path).toBe('/inline/foo');
    expect(await placement.list()).toEqual([]);
    await expect(placement.remove({ path: '/inline/foo', branchName: 'foo' })).resolves.toBeUndefined();
  });
});

describe('InMemoryWorktreePlacement', () => {
  it('fabricates a default path for a fresh intent', async () => {
    const placement = new InMemoryWorktreePlacement();
    const loc = await placement.ensure({ branchName: 'issue/19-worktree-manager' });

    expect(loc).toEqual({
      path: '/inmem/issue/19-worktree-manager',
      branchName: 'issue/19-worktree-manager'
    });
  });

  it('honors a custom pathFor override', async () => {
    const placement = new InMemoryWorktreePlacement({
      pathFor: (intent: WorktreeIntent) => `/custom/${intent.branchName.replace(/\//g, '-')}`
    });

    const loc = await placement.ensure({ branchName: 'issue/19-worktree-manager' });
    expect(loc.path).toBe('/custom/issue-19-worktree-manager');
  });

  it('is idempotent: ensure for the same branch returns the same location', async () => {
    const placement = new InMemoryWorktreePlacement();
    const first = await placement.ensure({ branchName: 'issue/19' });
    const second = await placement.ensure({ branchName: 'issue/19', suggestedPath: '/ignored' });

    expect(second).toEqual(first);
  });

  it('list returns every ensured location', async () => {
    const placement = new InMemoryWorktreePlacement();
    await placement.ensure({ branchName: 'issue/19' });
    await placement.ensure({ branchName: 'issue/20' });

    const all = (await placement.list()).map((loc) => loc.branchName).sort();
    expect(all).toEqual(['issue/19', 'issue/20']);
  });

  it('remove drops a known location and is idempotent on a missing one', async () => {
    const placement = new InMemoryWorktreePlacement();
    const loc = await placement.ensure({ branchName: 'issue/19' });

    await placement.remove(loc);
    expect(await placement.list()).toEqual([]);

    // Remove again — must not throw.
    await expect(placement.remove(loc)).resolves.toBeUndefined();
  });

  it('matches remove by branchName (path is informational, not the key)', async () => {
    const placement = new InMemoryWorktreePlacement();
    await placement.ensure({ branchName: 'issue/19' });

    await placement.remove({ path: '/somewhere/else', branchName: 'issue/19' });
    expect(await placement.list()).toEqual([]);
  });
});
