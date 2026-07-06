import { execa } from 'execa';

import { findIssueArtifacts } from '../core/artifacts.js';
import { loadLatestRun } from '../verification/store.js';
import {
  readGateVerdictRecord,
  type VerdictStatus
} from '../verification/verdict-store.js';
import { repoSlug } from '../core/gh.js';
import type { RepoRef } from '../core/types.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import { buildMergeReadinessComment } from './merge-comment.js';
import { defaultMergePolicy } from './merge-policy.js';
import { evaluateMergeReadiness } from './merge-readiness.js';
import {
  readMergeLabelStatus,
  readMergeReadinessRecord,
  writeMergeLabelVerdict,
  writeMergeReadinessRecord
} from './merge-store.js';
import type {
  MergeLabelStatus,
  MergeReadinessEvaluation,
  MergeReadinessRecord
} from './merge-types.js';
import { readPullRequestRecord } from './pr-store.js';
import type { GhCommandRunner } from './pr-types.js';
import { readCandidateBranchRecord } from './store.js';

export interface MergeExecutorDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  resolveIssueNumber: (repoRoot: string, override: number | undefined) => Promise<number>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  writeState: (
    repo: RepoRef,
    issueNumber: number,
    from: WorkflowState,
    to: WorkflowState
  ) => Promise<void>;
  readVerdict: (repo: RepoRef, issueNumber: number) => Promise<VerdictStatus | null>;
  readGateVerdictRecord: (repoRoot: string, issueNumber: number) => ReturnType<typeof readGateVerdictRecord>;
  loadLatestRun: typeof loadLatestRun;
  findIssueArtifacts: typeof findIssueArtifacts;
  readPullRequestRecord: typeof readPullRequestRecord;
  readCandidateBranchRecord: typeof readCandidateBranchRecord;
  readMergeReadinessRecord: typeof readMergeReadinessRecord;
  writeMergeReadinessRecord: typeof writeMergeReadinessRecord;
  readMergeLabelStatus: typeof readMergeLabelStatus;
  writeMergeLabelVerdict: typeof writeMergeLabelVerdict;
  runGh: GhCommandRunner;
  now?: () => Date;
}

export async function defaultRunGh(
  args: string[],
  options: { cwd: string; input?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa('gh', args, {
    cwd: options.cwd,
    input: options.input,
    reject: false
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1
  };
}

async function fetchPrState(
  deps: MergeExecutorDeps,
  repo: RepoRef,
  repoRoot: string,
  prNumber: number
): Promise<'OPEN' | 'CLOSED' | 'MERGED' | null> {
  const result = await deps.runGh(
    ['pr', 'view', String(prNumber), '--repo', repoSlug(repo), '--json', 'state'],
    { cwd: repoRoot }
  );

  if (result.exitCode !== 0) {
    return null;
  }

  try {
    const payload = JSON.parse(result.stdout) as { state?: string };
    const state = payload.state;
    if (state === 'OPEN' || state === 'CLOSED' || state === 'MERGED') {
      return state;
    }
    return null;
  } catch {
    return null;
  }
}

export async function gatherMergeReadinessInput(
  deps: MergeExecutorDeps,
  repoRoot: string,
  repo: RepoRef,
  issueNumber: number
) {
  const [
    state,
    verdict,
    gateVerdict,
    latestRun,
    artifacts,
    pullRequest,
    candidateRecord,
    policy
  ] = await Promise.all([
    deps.readState(repo, issueNumber),
    deps.readVerdict(repo, issueNumber),
    deps.readGateVerdictRecord(repoRoot, issueNumber),
    deps.loadLatestRun(repoRoot, issueNumber),
    deps.findIssueArtifacts(repoRoot, issueNumber),
    deps.readPullRequestRecord(repoRoot),
    deps.readCandidateBranchRecord(repoRoot),
    defaultMergePolicy(repoRoot)
  ]);

  const prState =
    pullRequest !== null ? await fetchPrState(deps, repo, repoRoot, pullRequest.prNumber) : null;

  return {
    issueNumber,
    state,
    verdict,
    verdictRunId: gateVerdict?.runId ?? null,
    latestRun,
    artifacts,
    pullRequest,
    prState,
    candidateRecord,
    policy
  };
}

export async function evaluateMergeReadinessLive(
  deps: MergeExecutorDeps,
  repoRoot: string,
  repo: RepoRef,
  issueNumber: number
): Promise<MergeReadinessEvaluation> {
  const input = await gatherMergeReadinessInput(deps, repoRoot, repo, issueNumber);
  return evaluateMergeReadiness(input);
}

export async function evaluateAndPersistMergeReadiness(
  deps: MergeExecutorDeps,
  repoRoot: string,
  repo: RepoRef,
  issueNumber: number
): Promise<{ evaluation: MergeReadinessEvaluation; record: MergeReadinessRecord }> {
  const evaluation = await evaluateMergeReadinessLive(deps, repoRoot, repo, issueNumber);
  const now = deps.now?.() ?? new Date();
  const existing = await deps.readMergeReadinessRecord(repoRoot);
  const pullRequest = await deps.readPullRequestRecord(repoRoot);

  const record: MergeReadinessRecord = {
    schemaVersion: 1,
    issueNumber,
    outcome: evaluation.outcome,
    checks: evaluation.checks,
    verificationRunId: (await deps.loadLatestRun(repoRoot, issueNumber))?.runId ?? null,
    pullRequestNumber: pullRequest?.prNumber ?? null,
    prCommentId: existing?.prCommentId ?? null,
    reason: evaluation.reason,
    nextAction: evaluation.nextAction,
    evaluatedAt: now.toISOString(),
    mergedAt: existing?.mergedAt
  };

  const previousLabel = await deps.readMergeLabelStatus(repo, issueNumber);
  const nextLabel: MergeLabelStatus = evaluation.outcome === 'ready' ? 'ready' : 'blocked';
  await deps.writeMergeLabelVerdict(repo, issueNumber, previousLabel, nextLabel);
  await deps.writeMergeReadinessRecord(repoRoot, record);

  return { evaluation, record };
}

export async function syncMergePrComment(
  deps: MergeExecutorDeps,
  repoRoot: string,
  repo: RepoRef,
  evaluation: MergeReadinessEvaluation,
  record: MergeReadinessRecord
): Promise<string | null> {
  if (record.pullRequestNumber === null) {
    return record.prCommentId;
  }

  const body = buildMergeReadinessComment(evaluation, record.evaluatedAt);
  const prNumber = record.pullRequestNumber;

  if (record.prCommentId) {
    const edit = await deps.runGh(
      [
        'api',
        '-X',
        'PATCH',
        `repos/${repoSlug(repo)}/issues/comments/${record.prCommentId}`,
        '-f',
        `body=${body}`
      ],
      { cwd: repoRoot }
    );

    if (edit.exitCode === 0) {
      return record.prCommentId;
    }
  }

  const list = await deps.runGh(
    [
      'api',
      `repos/${repoSlug(repo)}/issues/${prNumber}/comments`,
      '--jq',
      '.[] | select(.body | contains("freesolo-merge-readiness")) | .id'
    ],
    { cwd: repoRoot }
  );

  if (list.exitCode === 0 && list.stdout.trim()) {
    const commentId = list.stdout.trim().split('\n')[0];
    const edit = await deps.runGh(
      [
        'api',
        '-X',
        'PATCH',
        `repos/${repoSlug(repo)}/issues/comments/${commentId}`,
        '-f',
        `body=${body}`
      ],
      { cwd: repoRoot }
    );

    if (edit.exitCode === 0) {
      return commentId;
    }
  }

  const create = await deps.runGh(
    ['pr', 'comment', String(prNumber), '--repo', repoSlug(repo), '--body', body],
    { cwd: repoRoot }
  );

  if (create.exitCode !== 0) {
    throw new Error(create.stderr.trim() || 'Failed to post merge readiness PR comment');
  }

  const view = await deps.runGh(
    [
      'api',
      `repos/${repoSlug(repo)}/issues/${prNumber}/comments`,
      '--jq',
      'last | .id'
    ],
    { cwd: repoRoot }
  );

  return view.exitCode === 0 ? view.stdout.trim() || null : null;
}

export type MergeMethod = 'merge' | 'squash' | 'rebase';

export async function executeMerge(
  deps: MergeExecutorDeps,
  repoRoot: string,
  repo: RepoRef,
  issueNumber: number,
  options: { mergeMethod: MergeMethod; engineEnabled: boolean }
): Promise<{ evaluation: MergeReadinessEvaluation; merged: boolean }> {
  let record = await deps.readMergeReadinessRecord(repoRoot);
  let evaluation: MergeReadinessEvaluation;

  if (!record || record.outcome !== 'ready') {
    const result = await evaluateAndPersistMergeReadiness(deps, repoRoot, repo, issueNumber);
    evaluation = result.evaluation;
    record = result.record;
  } else {
    evaluation = await evaluateMergeReadinessLive(deps, repoRoot, repo, issueNumber);
    if (evaluation.outcome !== 'ready') {
      const result = await evaluateAndPersistMergeReadiness(deps, repoRoot, repo, issueNumber);
      evaluation = result.evaluation;
      record = result.record;
    }
  }

  if (evaluation.outcome !== 'ready' || record.pullRequestNumber === null) {
    return { evaluation, merged: false };
  }

  const mergeArgs = ['pr', 'merge', String(record.pullRequestNumber), '--repo', repoSlug(repo)];
  if (options.mergeMethod === 'squash') {
    mergeArgs.push('--squash');
  } else if (options.mergeMethod === 'rebase') {
    mergeArgs.push('--rebase');
  } else {
    mergeArgs.push('--merge');
  }

  const mergeResult = await deps.runGh(mergeArgs, { cwd: repoRoot });
  if (mergeResult.exitCode !== 0) {
    throw new Error(mergeResult.stderr.trim() || 'gh pr merge failed');
  }

  const state = await deps.readState(repo, issueNumber);
  if (state === 'pr-ready' && options.engineEnabled) {
    await deps.writeState(repo, issueNumber, 'pr-ready', 'merged');
  }

  const now = deps.now?.() ?? new Date();
  const updated: MergeReadinessRecord = {
    ...record,
    mergedAt: now.toISOString()
  };
  await deps.writeMergeReadinessRecord(repoRoot, updated);

  return { evaluation, merged: true };
}
