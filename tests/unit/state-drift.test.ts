import { describe, expect, it } from 'vitest';

import { detectWorktreeDrift, loadDriftCandidates } from '../../src/worktree-metadata/drift.js';
import type { WorktreeRecord } from '../../src/worktree-metadata/store.js';

const gitEntries = [
  { worktreePath: '/repo/.worktrees/wt-a', branchName: 'issue/1' },
  { worktreePath: '/repo/.worktrees/wt-b', branchName: 'issue/2' }
];

describe('detectWorktreeDrift', () => {
  it('reports onDiskOnly when git entry has no DB row', () => {
    const report = detectWorktreeDrift(gitEntries, []);
    expect(report.onDiskOnly).toEqual([
      { path: '/repo/.worktrees/wt-a', branch: 'issue/1' },
      { path: '/repo/.worktrees/wt-b', branch: 'issue/2' }
    ]);
    expect(report.metadataOnly).toEqual([]);
  });

  it('reports metadataOnly when DB row path is not in git list and path missing on disk', () => {
    const dbRows: WorktreeRecord[] = [
      {
        id: 1,
        path: '/stale/deleted-wt',
        branch: 'issue/99',
        agentOwner: null,
        issueId: 99,
        createdAt: '2026-06-05T10:00:00.000Z',
        lastSeenAt: '2026-06-05T10:00:00.000Z'
      }
    ];
    const report = detectWorktreeDrift(gitEntries, dbRows, () => false);
    expect(report.metadataOnly).toHaveLength(1);
    expect(report.metadataOnly[0]?.path).toBe('/stale/deleted-wt');
    expect(report.onDiskOnly).toHaveLength(2);
  });

  it('reports no drift when git entries match DB rows', () => {
    const dbRows: WorktreeRecord[] = gitEntries.map((entry, index) => ({
      id: index + 1,
      path: entry.worktreePath,
      branch: entry.branchName,
      agentOwner: 'cursor',
      issueId: index + 1,
      createdAt: '2026-06-05T10:00:00.000Z',
      lastSeenAt: '2026-06-05T10:00:00.000Z'
    }));
    const report = detectWorktreeDrift(gitEntries, dbRows);
    expect(report.onDiskOnly).toEqual([]);
    expect(report.metadataOnly).toEqual([]);
  });
});

describe('loadDriftCandidates', () => {
  it('includes rows whose path is in the git set', () => {
    const allRows: WorktreeRecord[] = [
      {
        id: 1,
        path: '/repo/.worktrees/wt-a',
        branch: 'issue/1',
        agentOwner: null,
        issueId: 1,
        createdAt: 't',
        lastSeenAt: 't'
      }
    ];
    const gitPaths = new Set(['/repo/.worktrees/wt-a']);
    const candidates = loadDriftCandidates(allRows, gitPaths, () => false);
    expect(candidates.map((row) => row.path)).toContain('/repo/.worktrees/wt-a');
  });

  it('includes rows whose path no longer exists on disk', () => {
    const allRows: WorktreeRecord[] = [
      {
        id: 1,
        path: '/stale/deleted',
        branch: 'issue/99',
        agentOwner: null,
        issueId: 99,
        createdAt: 't',
        lastSeenAt: 't'
      }
    ];
    const candidates = loadDriftCandidates(allRows, new Set(), () => false);
    expect(candidates).toHaveLength(1);
  });

  it('excludes rows outside git set when path still exists on disk', () => {
    const allRows: WorktreeRecord[] = [
      {
        id: 1,
        path: '/other/active',
        branch: 'issue/9',
        agentOwner: null,
        issueId: 9,
        createdAt: 't',
        lastSeenAt: 't'
      }
    ];
    const candidates = loadDriftCandidates(allRows, new Set(), () => true);
    expect(candidates).toHaveLength(0);
  });
});
