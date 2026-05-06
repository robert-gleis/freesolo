import { describe, expect, it } from 'vitest';

import { createStartPlan } from '../../src/commands/start.js';

function createPromptCancelError(): Error {
  const error = new Error('User force closed the prompt with SIGINT');
  error.name = 'ExitPromptError';
  return error;
}

describe('createStartPlan', () => {
  it('passes sorted status-enriched issues into the chooser', async () => {
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
            title: 'Active issue',
            body: '',
            url: 'https://github.com/robert-gleis/issueflow/issues/12',
            labels: [],
            assignees: ['robert-gleis'],
            slug: 'active-issue',
            status: 'In Progress'
          },
          {
            number: 13,
            title: 'Next issue',
            body: '',
            url: 'https://github.com/robert-gleis/issueflow/issues/13',
            labels: [],
            assignees: ['robert-gleis'],
            slug: 'next-issue',
            status: 'Todo'
          },
          {
            number: 14,
            title: 'Finished issue',
            body: '',
            url: 'https://github.com/robert-gleis/issueflow/issues/14',
            labels: [],
            assignees: ['robert-gleis'],
            slug: 'finished-issue',
            status: 'Done'
          },
          {
            number: 15,
            title: 'Untracked issue',
            body: '',
            url: 'https://github.com/robert-gleis/issueflow/issues/15',
            labels: [],
            assignees: ['robert-gleis'],
            slug: 'untracked-issue',
            status: null
          }
        ],
        listLocalBranches: async () => [],
        listWorktreeEntries: async () => [],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async () => undefined,
        findIssueArtifacts: async (repoRoot) => ({
          spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
          plan: null,
          planReview: null,
          implementationReview: null
        }),
        writeSessionState: async () => undefined,
        writeIssuePacket: async () => undefined,
        chooseIssue: async (issues) => {
          expect(issues.map((issue) => issue.status)).toEqual(['In Progress', 'Todo', 'Done', null]);
          return issues[0];
        },
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    );

    expect(result.mode).toBe('print-only');
  });

  it('returns print-only output without launching a process', async () => {
    const deps = {
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
          slug: 'ship-issueflow-start',
          status: null
        }
      ],
      listLocalBranches: async () => [],
      listWorktreeEntries: async () => [],
      createIssueWorktree: async () => undefined,
      attachExistingBranchToWorktree: async () => undefined,
      setupNewWorktree: async () => false,
      findIssueArtifacts: async (repoRoot: string) => ({
        spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
        plan: null,
        planReview: null,
        implementationReview: null
      }),
      writeSessionState: async () => undefined,
      writeIssuePacket: async () => undefined,
      chooseIssue: async (issues) => issues[0],
      confirmReuse: async () => true,
      now: () => new Date('2026-04-24T10:00:00.000Z')
    };

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: true
      },
      deps
    );

    expect(result.mode).toBe('print-only');

    if (result.mode === 'print-only') {
      expect(result.launchPlan.binary).toBe('codex');
      expect(result.launchPlan.cwd).toBe('/repo-12-ship-issueflow-start');
      expect(result.workspacePlan.action).toBe('create-worktree');
      expect(result.workspacePlan.setupCommands).toEqual([
        'git -C /repo worktree add -b issue/12-ship-issueflow-start /repo-12-ship-issueflow-start origin/main',
        'if [ -f /repo-12-ship-issueflow-start/scripts/setup-new-worktree.sh ]; then cd /repo-12-ship-issueflow-start && MAIN_REPO_ROOT=/repo bash scripts/setup-new-worktree.sh; fi'
      ]);
      expect(result.summaryLines).toContain('Source checkout: /repo');
      expect(result.summaryLines).toContain('Repo: /repo-12-ship-issueflow-start');
      expect(result.summaryLines).toContain('Issue: #12 Ship issueflow start');
      expect(result.summaryLines).toContain('Workspace action: create-worktree');
    }
  });

  it('writes the full stage-1 packet and enriched session state when launching', async () => {
    const packets: string[] = [];
    const states: unknown[] = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'cursor',
        printOnly: false
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
            slug: 'ship-issueflow-start',
            status: null
          }
        ],
        listLocalBranches: async () => [],
        listWorktreeEntries: async () => [],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async () => undefined,
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
        },
        chooseIssue: async (issues) => issues[0],
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    );

    expect(result.mode).toBe('launch');
    expect(packets[0]).toContain('## Labels');
    expect(packets[0]).toContain('workflow');
    expect(packets[0]).toContain('## Repo Root');
    expect(packets[0]).toContain('/repo-12-ship-issueflow-start');
    expect(packets[0]).toContain('/repo-12-ship-issueflow-start/docs/issueflow/specs/2026-04-20-issue-12-design.md');
    expect(packets[0]).toContain('/repo-12-ship-issueflow-start/docs/issueflow/plans/2026-04-21-issue-12-plan.md');
    expect(states[0]).toMatchObject({
      issueNumber: 12,
      repoRoot: '/repo-12-ship-issueflow-start',
      reviewGates: {
        plan: 'pending',
        implementation: 'pending'
      },
      createdAt: '2026-04-24T10:00:00.000Z',
      updatedAt: '2026-04-24T10:00:00.000Z',
      artifacts: {
        spec: '/repo-12-ship-issueflow-start/docs/issueflow/specs/2026-04-20-issue-12-design.md',
        plan: '/repo-12-ship-issueflow-start/docs/issueflow/plans/2026-04-21-issue-12-plan.md',
        planReview: null,
        implementationReview: null
      }
    });
  });

  it('runs a project setup hook after creating a new worktree and before discovering artifacts', async () => {
    const calls: string[] = [];

    const deps = {
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
          slug: 'ship-issueflow-start',
          status: null
        }
      ],
      listLocalBranches: async () => [],
      listWorktreeEntries: async () => [],
      createIssueWorktree: async (repoRoot: string, worktreePath: string, branchName: string) => {
        calls.push(`create:${repoRoot}:${worktreePath}:${branchName}`);
      },
      attachExistingBranchToWorktree: async () => undefined,
      setupNewWorktree: async (sourceCheckout: string, worktreePath: string) => {
        calls.push(`setup:${sourceCheckout}:${worktreePath}`);
        return true;
      },
      findIssueArtifacts: async (repoRoot: string) => {
        calls.push(`artifacts:${repoRoot}`);

        return {
          spec: `${repoRoot}/docs/issueflow/specs/2026-04-24-issue-12-design.md`,
          plan: null,
          planReview: null,
          implementationReview: null
        };
      },
      writeSessionState: async () => undefined,
      writeIssuePacket: async () => undefined,
      chooseIssue: async (issues) => issues[0],
      confirmReuse: async () => true,
      now: () => new Date('2026-04-24T10:00:00.000Z')
    };

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: false
      },
      deps
    );

    expect(result.mode).toBe('launch');
    expect(calls).toEqual([
      'create:/repo:/repo-12-ship-issueflow-start:issue/12-ship-issueflow-start',
      'setup:/repo:/repo-12-ship-issueflow-start',
      'artifacts:/repo-12-ship-issueflow-start'
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
            slug: 'ship-issueflow-start',
            status: null
          }
        ],
        listLocalBranches: async () => ['issue/12-ship-issueflow-start'],
        listWorktreeEntries: async () => [
          {
            branchName: 'issue/12-ship-issueflow-start',
            worktreePath: '/repo-12-ship-issueflow-start'
          }
        ],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async () => undefined,
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
        },
        chooseIssue: async (issues) => issues[0],
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    );

    expect(result.mode).toBe('launch');
    expect(artifactLookups).toEqual(['/repo-12-ship-issueflow-start']);
    expect(packets[0]).toContain('/repo-12-ship-issueflow-start/docs/issueflow/specs/2026-04-24-issue-12-design.md');
    expect(states[0]).toMatchObject({
      repoRoot: '/repo-12-ship-issueflow-start',
      worktreePath: '/repo-12-ship-issueflow-start'
    });
  });

  it('attaches an existing branch into a new worktree before discovering artifacts', async () => {
    const packets: string[] = [];
    const states: unknown[] = [];
    const artifactLookups: string[] = [];
    const attachedBranches: Array<{ repoRoot: string; worktreePath: string; branchName: string }> = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'codex',
        printOnly: false
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
            slug: 'ship-issueflow-start',
            status: null
          }
        ],
        listLocalBranches: async () => ['issue/12-ship-issueflow-start'],
        listWorktreeEntries: async () => [],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async (repoRoot, worktreePath, branchName) => {
          attachedBranches.push({ repoRoot, worktreePath, branchName });
        },
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
        },
        chooseIssue: async (issues) => issues[0],
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    );

    expect(result.mode).toBe('launch');
    expect(attachedBranches).toEqual([
      {
        repoRoot: '/repo',
        worktreePath: '/repo-12-ship-issueflow-start',
        branchName: 'issue/12-ship-issueflow-start'
      }
    ]);
    expect(artifactLookups).toEqual(['/repo-12-ship-issueflow-start']);
    expect(packets[0]).toContain('/repo-12-ship-issueflow-start/docs/issueflow/specs/2026-04-24-issue-12-design.md');
    expect(states[0]).toMatchObject({
      repoRoot: '/repo-12-ship-issueflow-start',
      branchName: 'issue/12-ship-issueflow-start',
      worktreePath: '/repo-12-ship-issueflow-start',
      artifacts: {
        spec: '/repo-12-ship-issueflow-start/docs/issueflow/specs/2026-04-24-issue-12-design.md',
        plan: '/repo-12-ship-issueflow-start/docs/issueflow/plans/2026-04-24-issue-12-plan.md',
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
      {
        resolveRepoRoot: async () => '/repo',
        readOriginRemote: async () => 'git@github.com:robert-gleis/issueflow.git',
        listAssignedIssues: async () => [],
        listLocalBranches: async () => [],
        listWorktreeEntries: async () => [],
        createIssueWorktree: async () => undefined,
        attachExistingBranchToWorktree: async () => undefined,
        findIssueArtifacts: async () => ({
          spec: null,
          plan: null,
          planReview: null,
          implementationReview: null
        }),
        writeSessionState: async () => undefined,
        writeIssuePacket: async () => undefined,
        chooseIssue: async () => {
          throw new Error('should not be called');
        },
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
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
        listLocalBranches: async () => {
          throw new Error('should not be called');
        },
        listWorktreeEntries: async () => {
          throw new Error('should not be called');
        },
        createIssueWorktree: async () => {
          throw new Error('should not be called');
        },
        attachExistingBranchToWorktree: async () => {
          throw new Error('should not be called');
        },
        findIssueArtifacts: async () => {
          throw new Error('should not be called');
        },
        writeSessionState: async () => {
          throw new Error('should not be called');
        },
        writeIssuePacket: async () => {
          throw new Error('should not be called');
        },
        chooseIssue: async () => {
          throw createPromptCancelError();
        },
        confirmReuse: async () => true,
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    );

    expect(result).toEqual({
      mode: 'cancelled',
      message: 'Cancelled.'
    });
  });

  it('returns a cancelled result when worktree reuse confirmation is aborted', async () => {
    const createWorktreeCalls: string[] = [];
    const attachWorktreeCalls: string[] = [];

    const result = await createStartPlan(
      {
        cwd: '/repo',
        tool: 'claude',
        printOnly: false
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
        listLocalBranches: async () => ['issue/12-ship-issueflow-start'],
        listWorktreeEntries: async () => [
          {
            branchName: 'issue/12-ship-issueflow-start',
            worktreePath: '/repo-12-ship-issueflow-start'
          }
        ],
        createIssueWorktree: async (_repoRoot, worktreePath) => {
          createWorktreeCalls.push(worktreePath);
        },
        attachExistingBranchToWorktree: async (_repoRoot, worktreePath) => {
          attachWorktreeCalls.push(worktreePath);
        },
        findIssueArtifacts: async () => {
          throw new Error('should not be called');
        },
        writeSessionState: async () => {
          throw new Error('should not be called');
        },
        writeIssuePacket: async () => {
          throw new Error('should not be called');
        },
        chooseIssue: async (issues) => issues[0],
        confirmReuse: async () => {
          throw createPromptCancelError();
        },
        now: () => new Date('2026-04-24T10:00:00.000Z')
      }
    );

    expect(result).toEqual({
      mode: 'cancelled',
      message: 'Cancelled.'
    });
    expect(createWorktreeCalls).toEqual([]);
    expect(attachWorktreeCalls).toEqual([]);
  });
});
