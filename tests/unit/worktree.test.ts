import { describe, expect, it } from 'vitest';

import {
  buildBranchName,
  ensureUniqueWorkspaceNames,
  findExistingWorkspaceMatch
} from '../../src/core/worktree.js';

describe('findExistingWorkspaceMatch', () => {
  it('prefers an existing worktree for the issue branch', () => {
    const match = findExistingWorkspaceMatch(
      ['issue/12-ship-issueflow-start'],
      [{ branchName: 'issue/12-ship-issueflow-start', worktreePath: '/tmp/issueflow-12-ship-issueflow-start' }],
      12
    );

    expect(match?.worktreePath).toBe('/tmp/issueflow-12-ship-issueflow-start');
  });
});

describe('buildBranchName', () => {
  it('uses the neutral issue prefix', () => {
    expect(buildBranchName({ number: 12, slug: 'ship-issueflow-start' })).toBe('issue/12-ship-issueflow-start');
  });
});

describe('ensureUniqueWorkspaceNames', () => {
  it('appends a numeric suffix when the default branch and path already exist', () => {
    expect(
      ensureUniqueWorkspaceNames(
        '/repo/issueflow',
        { number: 12, slug: 'ship-issueflow-start' },
        ['issue/12-ship-issueflow-start'],
        [{ branchName: 'issue/12-ship-issueflow-start', worktreePath: '/repo/issueflow-12-ship-issueflow-start' }]
      )
    ).toEqual({
      branchName: 'issue/12-ship-issueflow-start-2',
      worktreePath: '/repo/issueflow-12-ship-issueflow-start-2'
    });
  });
});
