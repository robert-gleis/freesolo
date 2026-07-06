import { describe, expect, it, vi } from 'vitest';

import {
  evaluateAndPersistMergeReadiness,
  executeMerge,
  syncMergePrComment,
  type MergeExecutorDeps
} from '../../src/integration/merge-executor.js';
import type { MergeReadinessRecord } from '../../src/integration/merge-types.js';
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

function makeDeps(overrides: Partial<MergeExecutorDeps> = {}): MergeExecutorDeps {
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
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    now: () => new Date('2026-06-08T08:02:00.000Z'),
    ...overrides
  };
}

describe('merge executor', () => {
  it('evaluateAndPersistMergeReadiness writes record and labels', async () => {
    const deps = makeDeps();
    const { evaluation } = await evaluateAndPersistMergeReadiness(deps, '/repo', repo, 44);
    expect(evaluation.outcome).toBe('ready');
    expect(deps.writeMergeReadinessRecord).toHaveBeenCalled();
    expect(deps.writeMergeLabelVerdict).toHaveBeenCalled();
  });

  it('executeMerge blocks when gates fail', async () => {
    const deps = makeDeps({
      readState: async () => 'implementing'
    });
    const { merged, evaluation } = await executeMerge(deps, '/repo', repo, 44, {
      mergeMethod: 'merge',
      engineEnabled: true
    });
    expect(merged).toBe(false);
    expect(evaluation.outcome).toBe('blocked');
  });

  it('executeMerge re-evaluates stale ready record', async () => {
    const stale: MergeReadinessRecord = {
      schemaVersion: 1,
      issueNumber: 44,
      outcome: 'ready',
      checks: [],
      verificationRunId: 'run-1',
      pullRequestNumber: 99,
      prCommentId: null,
      reason: 'old',
      nextAction: 'merge',
      evaluatedAt: '2026-06-08T07:00:00.000Z'
    };

    const deps = makeDeps({
      readMergeReadinessRecord: async () => stale,
      readState: async () => 'implementing'
    });

    const { merged } = await executeMerge(deps, '/repo', repo, 44, {
      mergeMethod: 'merge',
      engineEnabled: true
    });
    expect(merged).toBe(false);
    expect(deps.writeMergeReadinessRecord).toHaveBeenCalled();
  });

  it('executeMerge merges and transitions state on success', async () => {
    const ghCalls: string[][] = [];
    const deps = makeDeps({
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
      }
    });

    const { merged } = await executeMerge(deps, '/repo', repo, 44, {
      mergeMethod: 'squash',
      engineEnabled: true
    });

    expect(merged).toBe(true);
    expect(ghCalls.some((args) => args.includes('--squash'))).toBe(true);
    expect(deps.writeState).toHaveBeenCalledWith(repo, 44, 'pr-ready', 'merged');
  });

  it('syncMergePrComment posts a new comment when none exists', async () => {
    const ghCalls: string[][] = [];
    const deps = makeDeps({
      runGh: async (args) => {
        ghCalls.push(args);
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ state: 'OPEN' }), stderr: '', exitCode: 0 };
        }
        if (args[0] === 'api' && args.some((arg) => arg.includes('last'))) {
          return { stdout: '999', stderr: '', exitCode: 0 };
        }
        if (args[0] === 'api' && args.some((arg) => arg.includes('comments')) && !args.includes('PATCH')) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
    });

    const evaluation = {
      outcome: 'ready' as const,
      checks: [],
      reason: 'ok',
      nextAction: 'merge'
    };
    const record = {
      schemaVersion: 1 as const,
      issueNumber: 44,
      outcome: 'ready' as const,
      checks: [],
      verificationRunId: 'run-1',
      pullRequestNumber: 99,
      prCommentId: null,
      reason: 'ok',
      nextAction: 'merge',
      evaluatedAt: '2026-06-08T08:00:00.000Z'
    };

    const commentId = await syncMergePrComment(deps, '/repo', repo, evaluation, record);
    expect(commentId).toBe('999');
    expect(ghCalls.some((args) => args[0] === 'pr' && args[1] === 'comment')).toBe(true);
  });

  it('executeMerge does not transition state when gh merge fails', async () => {
    const deps = makeDeps({
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
        if (args[0] === 'pr' && args[1] === 'merge') {
          return { stdout: '', stderr: 'merge failed', exitCode: 1 };
        }
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ state: 'OPEN' }), stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      }
    });

    await expect(
      executeMerge(deps, '/repo', repo, 44, { mergeMethod: 'merge', engineEnabled: true })
    ).rejects.toThrow(/merge failed/);
    expect(deps.writeState).not.toHaveBeenCalled();
  });
});
