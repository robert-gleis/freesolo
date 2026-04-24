import { describe, expect, it } from 'vitest';

import { createStartPlan } from '../../src/commands/start.js';

describe('createStartPlan', () => {
  it('returns print-only output without launching a process', async () => {
    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: true
      },
      {
        resolveRepoRoot: async () => '/repo',
        readOriginRemote: async () => 'git@github.com:robert-gleis/issueflow.git',
        listAssignedIssues: async () => [
          {
            number: 12,
            title: 'Ship issueflow start',
            body: 'Build the first working start command.',
            url: 'https://github.com/robert-gleis/issueflow/issues/12',
            labels: ['workflow'],
            assignees: ['robert-gleis'],
            slug: 'ship-issueflow-start'
          }
        ],
        listLocalBranches: async () => [],
        listWorktreeEntries: async () => [],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async () => undefined,
        writeSessionState: async () => undefined,
        writeIssuePacket: async () => undefined,
        chooseIssue: async (issues) => issues[0],
        confirmReuse: async () => true
      }
    );

    expect(result.mode).toBe('print-only');

    if (result.mode === 'print-only') {
      expect(result.launchPlan.binary).toBe('codex');
      expect(result.launchPlan.cwd).toBe('/repo-12-ship-issueflow-start');
    }
  });

  it('returns an empty result when there are no assigned issues', async () => {
    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'claude',
        printOnly: true
      },
      {
        resolveRepoRoot: async () => '/repo',
        readOriginRemote: async () => 'git@github.com:robert-gleis/issueflow.git',
        listAssignedIssues: async () => [],
        listLocalBranches: async () => [],
        listWorktreeEntries: async () => [],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async () => undefined,
        writeSessionState: async () => undefined,
        writeIssuePacket: async () => undefined,
        chooseIssue: async () => {
          throw new Error('should not be called');
        },
        confirmReuse: async () => true
      }
    );

    expect(result).toEqual({
      mode: 'empty',
      message: 'No assigned open issues in this repository.'
    });
  });
});
