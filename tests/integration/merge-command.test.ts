import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { mergeEvaluateAction, mergeExecuteAction } from '../../src/commands/merge.js';
import type { MergeCommandDeps } from '../../src/commands/merge.js';
import type { VerificationRun } from '../../src/verification/types.js';
import type { RepoRef } from '../../src/core/types.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };

function passRun(runId = 'run-1'): VerificationRun {
  return {
    schemaVersion: 1,
    runId,
    issueNumber: 44,
    repoRoot: '',
    configPath: '/repo/issueflow.config.json',
    startedAt: '2026-06-08T08:00:00.000Z',
    finishedAt: '2026-06-08T08:01:00.000Z',
    status: 'pass',
    bail: false,
    checks: []
  };
}

describe('merge command integration', () => {
  let tmpDir: string;
  let repoRoot: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  async function setupRepo(): Promise<void> {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-int-'));
    repoRoot = tmpDir;
    await execa('git', ['init'], { cwd: repoRoot });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
    await execa('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
    await execa('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: repoRoot });
  }

  function makeDeps(overrides: Partial<MergeCommandDeps> = {}): MergeCommandDeps {
    let workflowState: 'pr-ready' | 'implementing' = 'pr-ready';
    let run = passRun();

    const base: MergeCommandDeps = {
      resolveRepoRoot: async () => repoRoot,
      resolveRepoRef: async () => repo,
      resolveIssueNumber: async () => 44,
      readState: async () => workflowState,
      writeState: async (_repo, _issue, _from, to) => {
        if (to === 'merged') {
          workflowState = 'implementing';
        }
        if (to === 'pr-ready') {
          workflowState = 'pr-ready';
        }
      },
      readVerdict: async () => 'pass',
      readGateVerdictRecord: async () => ({
        schemaVersion: 1,
        issueNumber: 44,
        runId: run.runId,
        outcome: 'pass',
        reason: 'ok',
        nextAction: 'merge',
        evaluatedAt: '2026-06-08T08:00:00.000Z'
      }),
      loadLatestRun: async () => run,
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
        verificationRunId: run.runId,
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
      writeMergeReadinessRecord: async () => path.join(repoRoot, '.git/issueflow/merge-readiness.json'),
      readMergeLabelStatus: async () => null,
      writeMergeLabelVerdict: async () => {},
      runGh: async (args) => {
        if (args[0] === 'pr' && args[1] === 'view') {
          return { stdout: JSON.stringify({ state: 'OPEN' }), stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      env: { ISSUEFLOW_ENGINE: '1' },
      write: () => {},
      setExitCode: () => {},
      now: () => new Date('2026-06-08T08:02:00.000Z')
    };

    const deps = { ...base, ...overrides };
    (deps as { _setState?: (s: 'pr-ready' | 'implementing') => void })._setState = (s) => {
      workflowState = s;
    };
    (deps as { _setRun?: (r: VerificationRun) => void })._setRun = (r) => {
      run = r;
    };
    return deps;
  }

  it('evaluate then merge succeeds on happy path', async () => {
    await setupRepo();
    let evalExit = 0;
    let mergeExit = 0;

    await mergeEvaluateAction(
      {},
      makeDeps({
        setExitCode: (code) => {
          evalExit = code;
        }
      })
    );
    expect(evalExit).toBe(0);

    await mergeExecuteAction(
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
          evaluatedAt: '2026-06-08T08:02:00.000Z'
        }),
        setExitCode: (code) => {
          mergeExit = code;
        }
      })
    );
    expect(mergeExit).toBe(0);
  });

  it('stale verification blocks then restores ready after new pass', async () => {
    await setupRepo();
    let exitCode = 0;

    await mergeEvaluateAction(
      {},
      makeDeps({
        readGateVerdictRecord: async () => ({
          schemaVersion: 1,
          issueNumber: 44,
          runId: 'old-run',
          outcome: 'pass',
          reason: 'ok',
          nextAction: 'merge',
          evaluatedAt: '2026-06-08T08:00:00.000Z'
        }),
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(1);

    exitCode = 0;
    await mergeEvaluateAction(
      {},
      makeDeps({
        readGateVerdictRecord: async () => ({
          schemaVersion: 1,
          issueNumber: 44,
          runId: 'run-1',
          outcome: 'pass',
          reason: 'ok',
          nextAction: 'merge',
          evaluatedAt: '2026-06-08T08:02:00.000Z'
        }),
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );
    expect(exitCode).toBe(0);
  });

  it('workflow rollback blocks merge evaluate', async () => {
    await setupRepo();
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
});
