import { describe, expect, it, vi } from 'vitest';

import {
  mergeEvaluateAction,
  mergeExecuteAction,
  mergeShowAction,
  type MergeCommandDeps
} from '../../src/commands/merge.js';
import { MultipleMergeLabelVerdictsError } from '../../src/integration/merge-store.js';
import type { VerificationRun } from '../../src/verification/types.js';
import type { RepoRef } from '../../src/core/types.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };

function passRun(): VerificationRun {
  return {
    schemaVersion: 1,
    runId: 'run-1',
    issueNumber: 44,
    repoRoot: '/repo',
    configPath: '/repo/freesolo.config.json',
    startedAt: '2026-06-08T08:00:00.000Z',
    finishedAt: '2026-06-08T08:01:00.000Z',
    status: 'pass',
    bail: false,
    checks: []
  };
}

function makeDeps(overrides: Partial<MergeCommandDeps> = {}): MergeCommandDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    resolveRepoRef: async () => repo,
    resolveIssueNumber: async () => 44,
    readState: async () => 'pr-ready',
    writeState: vi.fn(async () => {}),
    readVerdict: async () => 'pass',
    readGateVerdictRecord: async () => ({
      schemaVersion: 1,
      issueNumber: 44,
      runId: 'run-1',
      outcome: 'pass',
      reason: 'ok',
      nextAction: 'merge',
      evaluatedAt: '2026-06-08T08:00:00.000Z'
    }),
    loadLatestRun: async () => passRun(),
    findIssueArtifacts: async () => ({
      spec: null,
      plan: null,
      planReview: null,
      implementationReview: '/repo/review.md'
    }),
    readPullRequestRecord: async () => ({
      issueNumber: 44,
      issueSlug: 'merge-readiness-check',
      prNumber: 99,
      prUrl: 'https://github.com/acme/widgets/pull/99',
      title: 'Issue #44',
      headBranch: 'candidate/44-merge-readiness-check',
      baseBranch: 'main',
      verificationRunId: 'run-1',
      implementationReviewPath: '/repo/review.md',
      specPath: null,
      createdAt: '2026-06-08T08:00:00.000Z'
    }),
    readCandidateBranchRecord: async () => ({
      branchName: 'candidate/44-merge-readiness-check',
      issueNumber: 44,
      issueSlug: 'merge-readiness-check',
      teamId: 'team-1',
      sources: [],
      baseBranch: 'main',
      mergeCommitSha: 'abc',
      status: 'ready',
      createdAt: '2026-06-08T08:00:00.000Z',
      updatedAt: '2026-06-08T08:00:00.000Z'
    }),
    readMergeReadinessRecord: async () => null,
    writeMergeReadinessRecord: vi.fn(async () => '/repo/.git/freesolo/merge-readiness.json'),
    readMergeLabelStatus: async () => null,
    writeMergeLabelVerdict: vi.fn(async () => {}),
    runGh: async (args) => {
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ state: 'OPEN' }), stderr: '', exitCode: 0 };
      }
      if (args[0] === 'pr' && args[1] === 'comment') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '12345', stderr: '', exitCode: 0 };
    },
    env: { FREESOLO_ENGINE: '1' },
    write: () => {},
    setExitCode: () => {},
    now: () => new Date('2026-06-08T08:02:00.000Z'),
    ...overrides
  };
}

describe('mergeEvaluateAction', () => {
  it('exits 0 when ready', async () => {
    let exitCode = 0;
    await mergeEvaluateAction(
      {},
      makeDeps({
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(0);
  });

  it('exits 1 when blocked', async () => {
    let exitCode = 0;
    await mergeEvaluateAction(
      {},
      makeDeps({
        readState: async () => 'implementing',
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(1);
  });

  it('exits 2 when no pull request record', async () => {
    let exitCode = 0;
    await mergeEvaluateAction(
      {},
      makeDeps({
        readPullRequestRecord: async () => null,
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(2);
  });

  it('exits 4 on multiple merge labels', async () => {
    let exitCode = 0;
    await mergeEvaluateAction(
      {},
      makeDeps({
        readMergeLabelStatus: async () => {
          throw new MultipleMergeLabelVerdictsError(44, ['merge:ready', 'merge:blocked']);
        },
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(4);
  });

  it('print-only does not persist', async () => {
    let exitCode = 0;
    const writeRecord = vi.fn();
    await mergeEvaluateAction(
      { printOnly: true },
      makeDeps({
        writeMergeReadinessRecord: writeRecord,
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(writeRecord).not.toHaveBeenCalled();
    expect(exitCode).toBe(0);
  });
});

describe('mergeExecuteAction', () => {
  it('exits 3 without FREESOLO_ENGINE when state is pr-ready', async () => {
    let exitCode = 0;
    await mergeExecuteAction(
      {},
      makeDeps({
        env: {},
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(3);
  });

  it('forwards merge method to gh', async () => {
    const ghCalls: string[][] = [];
    let exitCode = 0;
    await mergeExecuteAction(
      { mergeMethod: 'rebase' },
      makeDeps({
        readMergeReadinessRecord: async () => ({
          schemaVersion: 1,
          issueNumber: 44,
          outcome: 'ready',
          checks: [],
          verificationRunId: 'run-1',
          pullRequestNumber: 99,
          prCommentId: null,
          reason: 'ok',
          nextAction: 'merge',
          evaluatedAt: '2026-06-08T08:00:00.000Z'
        }),
        runGh: async (args) => {
          ghCalls.push(args);
          if (args[0] === 'pr' && args[1] === 'view') {
            return { stdout: JSON.stringify({ state: 'OPEN' }), stderr: '', exitCode: 0 };
          }
          return { stdout: '', stderr: '', exitCode: 0 };
        },
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(ghCalls.some((args) => args.includes('--rebase'))).toBe(true);
    expect(exitCode).toBe(0);
  });
});

describe('mergeShowAction', () => {
  it('prints record JSON', async () => {
    const output: string[] = [];
    let exitCode = 0;
    await mergeShowAction(
      {},
      makeDeps({
        readMergeReadinessRecord: async () => ({
          schemaVersion: 1,
          issueNumber: 44,
          outcome: 'ready',
          checks: [],
          verificationRunId: 'run-1',
          pullRequestNumber: 99,
          prCommentId: null,
          reason: 'ok',
          nextAction: 'merge',
          evaluatedAt: '2026-06-08T08:00:00.000Z'
        }),
        write: (_channel, msg) => output.push(msg),
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(output.join('')).toContain('"outcome": "ready"');
    expect(exitCode).toBe(0);
  });
});
