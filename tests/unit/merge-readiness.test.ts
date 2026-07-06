import { describe, expect, it } from 'vitest';

import { evaluateMergeReadiness } from '../../src/integration/merge-readiness.js';
import type { MergeReadinessInput } from '../../src/integration/merge-types.js';
import type { VerificationRun } from '../../src/verification/types.js';

const defaultPolicy = {
  requireCandidateBranch: true,
  requireImplementationReview: true
};

function passRun(runId = 'run-1'): VerificationRun {
  return {
    schemaVersion: 1,
    runId,
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

function baseInput(overrides: Partial<MergeReadinessInput> = {}): MergeReadinessInput {
  return {
    issueNumber: 44,
    state: 'pr-ready',
    verdict: 'pass',
    verdictRunId: 'run-1',
    latestRun: passRun(),
    artifacts: {
      spec: null,
      plan: null,
      planReview: null,
      implementationReview: '/repo/docs/reviews/impl.md'
    },
    pullRequest: {
      issueNumber: 44,
      issueSlug: 'merge-readiness-check',
      prNumber: 99,
      prUrl: 'https://github.com/acme/widgets/pull/99',
      title: 'Issue #44: Merge Readiness Check',
      headBranch: 'candidate/44-merge-readiness-check',
      baseBranch: 'main',
      verificationRunId: 'run-1',
      implementationReviewPath: '/repo/docs/reviews/impl.md',
      specPath: null,
      createdAt: '2026-06-08T08:00:00.000Z'
    },
    prState: 'OPEN',
    candidateRecord: {
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
    },
    policy: defaultPolicy,
    ...overrides
  };
}

describe('evaluateMergeReadiness', () => {
  it('returns ready when all gates pass', () => {
    const result = evaluateMergeReadiness(baseInput());
    expect(result.outcome).toBe('ready');
  });

  it('blocks on wrong workflow state', () => {
    const result = evaluateMergeReadiness(baseInput({ state: 'implementing' }));
    expect(result.outcome).toBe('blocked');
    expect(result.checks.find((c) => c.id === 'workflow-state')?.status).toBe('fail');
  });

  it('blocks when no verification run', () => {
    const result = evaluateMergeReadiness(baseInput({ latestRun: null }));
    expect(result.checks.find((c) => c.id === 'verification-run')?.status).toBe('fail');
  });

  it('blocks on stale verdict runId', () => {
    const result = evaluateMergeReadiness(
      baseInput({ verdictRunId: 'old-run', latestRun: passRun('new-run') })
    );
    expect(result.checks.find((c) => c.id === 'verification-verdict')?.status).toBe('fail');
    expect(result.checks.find((c) => c.id === 'verification-verdict')?.detail).toMatch(/Stale/);
  });

  it('blocks when verdict pass but gate record runId is null', () => {
    const result = evaluateMergeReadiness(baseInput({ verdictRunId: null }));
    expect(result.checks.find((c) => c.id === 'verification-verdict')?.status).toBe('fail');
  });

  it('blocks when both review artifacts absent', () => {
    const result = evaluateMergeReadiness(
      baseInput({
        artifacts: { spec: null, plan: null, planReview: null, implementationReview: null }
      })
    );
    expect(result.checks.find((c) => c.id === 'review-artifact')?.status).toBe('fail');
  });

  it('passes review with planReview fallback under default policy', () => {
    const result = evaluateMergeReadiness(
      baseInput({
        artifacts: {
          spec: null,
          plan: null,
          planReview: '/repo/plan-review.md',
          implementationReview: null
        }
      })
    );
    expect(result.checks.find((c) => c.id === 'review-artifact')?.status).toBe('pass');
  });

  it('blocks when no pull request record', () => {
    const result = evaluateMergeReadiness(baseInput({ pullRequest: null }));
    expect(result.checks.find((c) => c.id === 'pull-request')?.status).toBe('fail');
  });

  it('blocks when PR is not open', () => {
    const result = evaluateMergeReadiness(baseInput({ prState: 'MERGED' }));
    expect(result.checks.find((c) => c.id === 'pull-request')?.status).toBe('fail');
  });

  it('blocks on candidate conflict', () => {
    const result = evaluateMergeReadiness(
      baseInput({
        candidateRecord: {
          ...baseInput().candidateRecord!,
          status: 'conflict',
          mergeCommitSha: null
        }
      })
    );
    expect(result.checks.find((c) => c.id === 'candidate-branch')?.status).toBe('fail');
  });

  it('skips candidate branch for issue branch head', () => {
    const result = evaluateMergeReadiness(
      baseInput({
        candidateRecord: null,
        pullRequest: {
          ...baseInput().pullRequest!,
          headBranch: 'issue/44-merge-readiness-check'
        }
      })
    );
    expect(result.checks.find((c) => c.id === 'candidate-branch')?.status).toBe('skip');
    expect(result.outcome).toBe('ready');
  });

  it('skips candidate branch when policy disables requirement', () => {
    const result = evaluateMergeReadiness(
      baseInput({
        candidateRecord: null,
        policy: { requireCandidateBranch: false, requireImplementationReview: true },
        pullRequest: {
          ...baseInput().pullRequest!,
          headBranch: 'issue/44-merge-readiness-check'
        }
      })
    );
    expect(result.checks.find((c) => c.id === 'candidate-branch')?.status).toBe('skip');
  });

  it('passes with planReview when requireImplementationReview is false', () => {
    const result = evaluateMergeReadiness(
      baseInput({
        policy: { requireCandidateBranch: true, requireImplementationReview: false },
        artifacts: {
          spec: null,
          plan: null,
          planReview: '/repo/plan-review.md',
          implementationReview: null
        }
      })
    );
    expect(result.checks.find((c) => c.id === 'review-artifact')?.status).toBe('pass');
  });
});
