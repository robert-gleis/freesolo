import { describe, expect, it } from 'vitest';

import { createStartPlan, type StartPlanDeps } from '../../src/commands/start.js';
import { WorktrunkMissingError } from '../../src/core/worktree.js';

function createPromptCancelError(): Error {
  const error = new Error('User force closed the prompt with SIGINT');
  error.name = 'ExitPromptError';
  return error;
}

function issue(overrides: Partial<Awaited<ReturnType<StartPlanDeps['listAssignedIssues']>>[number]> = {}) {
  return {
    number: 12,
    title: 'Ship issueflow start',
    body: 'Build the first working start command.',
    url: 'https://github.com/robert-gleis/issueflow/issues/12',
    labels: ['workflow'],
    assignees: ['robert-gleis'],
    slug: 'ship-issueflow-start',
    status: null,
    ...overrides
  };
}

function createDeps(overrides: Partial<StartPlanDeps> = {}): StartPlanDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    readOriginRemote: async () => 'git@github.com:robert-gleis/issueflow.git',
    ensureWorktrunkAvailable: async () => undefined,
    listAssignedIssues: async () => [issue()],
    listLocalBranches: async () => [],
    listWorktreeEntries: async () => [],
    switchNewIssueWorktree: async () => undefined,
    switchExistingIssueWorktree: async () => undefined,
    resolveBranchWorktreePath: async (_repoRoot, branchName) => `/wt/${branchName.replaceAll('/', '-')}`,
    setupNewWorktree: async () => false,
    findIssueArtifacts: async (repoRoot) => ({
      spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
      plan: null,
      planReview: null,
      implementationReview: null
    }),
    writeSessionState: async () => undefined,
    writeIssuePacket: async () => undefined,
    chooseIssue: async (issues) => issues[0],
    confirmReuse: async () => true,
    now: () => new Date('2026-04-24T10:00:00.000Z'),
    ...overrides
  };
}

describe('createStartPlan', () => {
  it('fails before workspace mutation when Worktrunk is missing', async () => {
    const calls: string[] = [];

    await expect(
      createStartPlan(
        {
          cwd: '/repo',
          tool: 'codex',
          printOnly: false
        },
        createDeps({
          ensureWorktrunkAvailable: async () => {
            throw new WorktrunkMissingError();
          },
          listAssignedIssues: async () => {
            calls.push('issues');
            return [];
          },
          listLocalBranches: async () => {
            calls.push('branches');
            return [];
          },
          listWorktreeEntries: async () => {
            calls.push('worktrees');
            return [];
          },
          switchNewIssueWorktree: async () => {
            calls.push('switch-new');
          },
          switchExistingIssueWorktree: async () => {
            calls.push('switch-existing');
          },
          resolveBranchWorktreePath: async () => {
            calls.push('resolve-path');
            return '/wt/path';
          }
        })
      )
    ).rejects.toMatchObject({ name: 'WorktrunkMissingError' });

    expect(calls).toEqual([]);
  });

  it('passes sorted status-enriched issues into the chooser', async () => {
    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: true
      },
      createDeps({
        listAssignedIssues: async () => [
          issue({ number: 12, title: 'Active issue', slug: 'active-issue', labels: [], status: 'In Progress' }),
          issue({ number: 13, title: 'Next issue', slug: 'next-issue', labels: [], status: 'Todo' }),
          issue({ number: 14, title: 'Finished issue', slug: 'finished-issue', labels: [], status: 'Done' }),
          issue({ number: 15, title: 'Untracked issue', slug: 'untracked-issue', labels: [], status: null })
        ],
        chooseIssue: async (issues) => {
          expect(issues.map((selectedIssue) => selectedIssue.status)).toEqual(['In Progress', 'Todo', 'Done', null]);
          return issues[0];
        }
      })
    );

    expect(result.mode).toBe('print-only');
  });

  it('returns Worktrunk print-only output without launching a process', async () => {
    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: true
      },
      createDeps()
    );

    expect(result.mode).toBe('print-only');

    if (result.mode === 'print-only') {
      expect(result.launchPlan.binary).toBe('codex');
      expect(result.launchPlan.cwd).toBe('<worktrunk-checkout>');
      expect(result.workspacePlan.action).toBe('create-worktree');
      expect(result.workspacePlan.setupCommands).toEqual([
        'wt switch --create issue/12-ship-issueflow-start',
        'Worktree path will be resolved by Worktrunk when executed.'
      ]);
      expect(result.summaryLines).toContain('Source checkout: /repo');
      expect(result.summaryLines).toContain('Repo: <worktrunk-checkout>');
      expect(result.summaryLines).toContain('Worktree: resolved by Worktrunk');
      expect(result.summaryLines).toContain('Issue: #12 Ship issueflow start');
      expect(result.summaryLines).toContain('Workspace action: create-worktree');
    }
  });

  it('writes the full stage-1 packet and enriched session state with the resolved Worktrunk path', async () => {
    const packets: string[] = [];
    const states: unknown[] = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'cursor',
        printOnly: false
      },
      createDeps({
        resolveBranchWorktreePath: async () => '/wt/issue-12-ship-issueflow-start',
        findIssueArtifacts: async (repoRoot) => ({
          spec: `${repoRoot}/docs/issueflow/specs/2026-04-20-issue-12-design.md`,
          plan: `${repoRoot}/docs/issueflow/plans/2026-04-21-issue-12-plan.md`,
          planReview: null,
          implementationReview: null
        }),
        writeSessionState: async (_worktreePath, state) => {
          states.push(state);
        },
        writeIssuePacket: async (_worktreePath, packet) => {
          packets.push(packet);
        }
      })
    );

    expect(result.mode).toBe('launch');
    expect(packets[0]).toContain('## Labels');
    expect(packets[0]).toContain('workflow');
    expect(packets[0]).toContain('## Repo Root');
    expect(packets[0]).toContain('/wt/issue-12-ship-issueflow-start');
    expect(packets[0]).toContain('/wt/issue-12-ship-issueflow-start/docs/issueflow/specs/2026-04-20-issue-12-design.md');
    expect(packets[0]).toContain('/wt/issue-12-ship-issueflow-start/docs/issueflow/plans/2026-04-21-issue-12-plan.md');
    expect(states[0]).toMatchObject({
      issueNumber: 12,
      repoRoot: '/wt/issue-12-ship-issueflow-start',
      reviewGates: {
        plan: 'pending',
        implementation: 'pending'
      },
      reviewLoops: {
        plan: {
          currentRound: 1,
          maxRounds: 5
        },
        implementation: {
          currentRound: 1,
          maxRounds: 5
        }
      },
      createdAt: '2026-04-24T10:00:00.000Z',
      updatedAt: '2026-04-24T10:00:00.000Z',
      artifacts: {
        spec: '/wt/issue-12-ship-issueflow-start/docs/issueflow/specs/2026-04-20-issue-12-design.md',
        plan: '/wt/issue-12-ship-issueflow-start/docs/issueflow/plans/2026-04-21-issue-12-plan.md',
        planReview: null,
        implementationReview: null
      }
    });
    if (result.mode === 'launch') {
      expect(result.launchPlan.args.join('\n')).toContain('Plan Review/Fix Loop');
      expect(result.launchPlan.args.join('\n')).toContain('Implementation Review/Fix Loop');
      expect(result.launchPlan.args.join('\n')).toContain('up to 5 rounds');
    }
  });

  it('runs a project setup hook after Worktrunk creates a new worktree and before discovering artifacts', async () => {
    const calls: string[] = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: false
      },
      createDeps({
        ensureWorktrunkAvailable: async () => {
          calls.push('wt-check');
        },
        switchNewIssueWorktree: async (repoRoot, branchName) => {
          calls.push(`switch-new:${repoRoot}:${branchName}`);
        },
        resolveBranchWorktreePath: async (repoRoot, branchName) => {
          calls.push(`resolve:${repoRoot}:${branchName}`);
          return '/wt/issue-12-ship-issueflow-start';
        },
        setupNewWorktree: async (sourceCheckout, worktreePath) => {
          calls.push(`setup:${sourceCheckout}:${worktreePath}`);
          return true;
        },
        findIssueArtifacts: async (repoRoot) => {
          calls.push(`artifacts:${repoRoot}`);

          return {
            spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
            plan: null,
            planReview: null,
            implementationReview: null
          };
        }
      })
    );

    expect(result.mode).toBe('launch');
    expect(calls).toEqual([
      'wt-check',
      'switch-new:/repo:issue/12-ship-issueflow-start',
      'resolve:/repo:issue/12-ship-issueflow-start',
      'setup:/repo:/wt/issue-12-ship-issueflow-start',
      'artifacts:/wt/issue-12-ship-issueflow-start'
    ]);
  });

  it('reuses the selected worktree as the artifact lookup and session root', async () => {
    const packets: string[] = [];
    const states: unknown[] = [];
    const artifactLookups: string[] = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'claude',
        printOnly: false
      },
      createDeps({
        listLocalBranches: async () => ['issue/12-ship-issueflow-start'],
        listWorktreeEntries: async () => [
          {
            branchName: 'issue/12-ship-issueflow-start',
            worktreePath: '/wt/issue-12-ship-issueflow-start'
          }
        ],
        findIssueArtifacts: async (repoRoot) => {
          artifactLookups.push(repoRoot);

          return {
            spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
            plan: null,
            planReview: null,
            implementationReview: null
          };
        },
        writeSessionState: async (_worktreePath, state) => {
          states.push(state);
        },
        writeIssuePacket: async (_worktreePath, packet) => {
          packets.push(packet);
        }
      })
    );

    expect(result.mode).toBe('launch');
    expect(artifactLookups).toEqual(['/wt/issue-12-ship-issueflow-start']);
    expect(packets[0]).toContain('/wt/issue-12-ship-issueflow-start/docs/issueflow/specs/2026-04-24-issue-12-design.md');
    expect(states[0]).toMatchObject({
      repoRoot: '/wt/issue-12-ship-issueflow-start',
      worktreePath: '/wt/issue-12-ship-issueflow-start'
    });
  });

  it('switches an existing branch through Worktrunk before discovering artifacts', async () => {
    const packets: string[] = [];
    const states: unknown[] = [];
    const artifactLookups: string[] = [];
    const switchedBranches: Array<{ repoRoot: string; branchName: string }> = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: false
      },
      createDeps({
        listLocalBranches: async () => ['issue/12-ship-issueflow-start'],
        listWorktreeEntries: async () => [],
        switchExistingIssueWorktree: async (repoRoot, branchName) => {
          switchedBranches.push({ repoRoot, branchName });
        },
        resolveBranchWorktreePath: async () => '/wt/issue-12-ship-issueflow-start',
        findIssueArtifacts: async (repoRoot) => {
          artifactLookups.push(repoRoot);

          return {
            spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
            plan: `${repoRoot}/docs/issueflow/plans/2026-04-24-issue-12-plan.md`,
            planReview: null,
            implementationReview: null
          };
        },
        writeSessionState: async (_worktreePath, state) => {
          states.push(state);
        },
        writeIssuePacket: async (_worktreePath, packet) => {
          packets.push(packet);
        }
      })
    );

    expect(result.mode).toBe('launch');
    expect(switchedBranches).toEqual([
      {
        repoRoot: '/repo',
        branchName: 'issue/12-ship-issueflow-start'
      }
    ]);
    expect(artifactLookups).toEqual(['/wt/issue-12-ship-issueflow-start']);
    expect(packets[0]).toContain('/wt/issue-12-ship-issueflow-start/docs/issueflow/specs/2026-04-24-issue-12-design.md');
    expect(states[0]).toMatchObject({
      repoRoot: '/wt/issue-12-ship-issueflow-start',
      branchName: 'issue/12-ship-issueflow-start',
      worktreePath: '/wt/issue-12-ship-issueflow-start',
      artifacts: {
        spec: '/wt/issue-12-ship-issueflow-start/docs/issueflow/specs/2026-04-24-issue-12-design.md',
        plan: '/wt/issue-12-ship-issueflow-start/docs/issueflow/plans/2026-04-24-issue-12-plan.md',
        planReview: null,
        implementationReview: null
      }
    });
  });

  it('returns an empty result when there are no assigned issues', async () => {
    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'claude',
        printOnly: true
      },
      createDeps({
        listAssignedIssues: async () => [],
        chooseIssue: async () => {
          throw new Error('should not be called');
        }
      })
    );

    expect(result).toEqual({
      mode: 'empty',
      message: 'No assigned open issues in this repository.'
    });
  });

  it('returns a cancelled result when issue selection is aborted', async () => {
    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: false
      },
      createDeps({
        chooseIssue: async () => {
          throw createPromptCancelError();
        },
        listLocalBranches: async () => {
          throw new Error('should not be called');
        },
        listWorktreeEntries: async () => {
          throw new Error('should not be called');
        },
        switchNewIssueWorktree: async () => {
          throw new Error('should not be called');
        },
        switchExistingIssueWorktree: async () => {
          throw new Error('should not be called');
        },
        findIssueArtifacts: async () => {
          throw new Error('should not be called');
        }
      })
    );

    expect(result).toEqual({
      mode: 'cancelled',
      message: 'Cancelled.'
    });
  });

  it('returns a cancelled result when worktree reuse confirmation is aborted', async () => {
    const switchCalls: string[] = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'claude',
        printOnly: false
      },
      createDeps({
        listLocalBranches: async () => ['issue/12-ship-issueflow-start'],
        listWorktreeEntries: async () => [
          {
            branchName: 'issue/12-ship-issueflow-start',
            worktreePath: '/wt/issue-12-ship-issueflow-start'
          }
        ],
        switchNewIssueWorktree: async (_repoRoot, branchName) => {
          switchCalls.push(branchName);
        },
        switchExistingIssueWorktree: async (_repoRoot, branchName) => {
          switchCalls.push(branchName);
        },
        findIssueArtifacts: async () => {
          throw new Error('should not be called');
        },
        confirmReuse: async () => {
          throw createPromptCancelError();
        }
      })
    );

    expect(result).toEqual({
      mode: 'cancelled',
      message: 'Cancelled.'
    });
    expect(switchCalls).toEqual([]);
  });
});
