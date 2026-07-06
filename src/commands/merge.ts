import { Command, InvalidArgumentError, Option } from 'commander';

import { findIssueArtifacts } from '../core/artifacts.js';
import {
  resolveRepoRef as defaultResolveRepoRef,
  resolveRepoRoot as defaultResolveRepoRoot
} from '../core/git.js';
import { IssueIdError, resolveIssueNumber as defaultResolveIssueNumber } from '../core/issue-id.js';
import {
  evaluateAndPersistMergeReadiness,
  evaluateMergeReadinessLive,
  executeMerge,
  syncMergePrComment,
  type MergeExecutorDeps,
  type MergeMethod
} from '../integration/merge-executor.js';
import { buildMergeReadinessComment } from '../integration/merge-comment.js';
import {
  MergeReadinessError,
  type MergeReadinessRecord
} from '../integration/merge-types.js';
import {
  MultipleMergeLabelVerdictsError,
  readMergeReadinessRecord as defaultReadMergeReadinessRecord,
  writeMergeReadinessRecord as defaultWriteMergeReadinessRecord,
  readMergeLabelStatus as defaultReadMergeLabelStatus,
  writeMergeLabelVerdict as defaultWriteMergeLabelVerdict
} from '../integration/merge-store.js';
import { defaultRunGh } from '../integration/merge-executor.js';
import { readPullRequestRecord as defaultReadPullRequestRecord } from '../integration/pr-store.js';
import { readCandidateBranchRecord as defaultReadCandidateBranchRecord } from '../integration/store.js';
import { loadLatestRun as defaultLoadLatestRun } from '../verification/store.js';
import {
  readGateVerdictRecord as defaultReadGateVerdictRecord,
  readVerdict as defaultReadVerdict
} from '../verification/verdict-store.js';
import {
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/local-state-store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface MergeCommandDeps extends MergeExecutorDeps {
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: MergeCommandDeps = {
  resolveRepoRoot: defaultResolveRepoRoot,
  resolveRepoRef: defaultResolveRepoRef,
  resolveIssueNumber: (repoRoot, override) => defaultResolveIssueNumber(repoRoot, override),
  readState: defaultReadState,
  writeState: defaultWriteState,
  readVerdict: defaultReadVerdict,
  readGateVerdictRecord: defaultReadGateVerdictRecord,
  loadLatestRun: defaultLoadLatestRun,
  findIssueArtifacts,
  readPullRequestRecord: defaultReadPullRequestRecord,
  readCandidateBranchRecord: defaultReadCandidateBranchRecord,
  readMergeReadinessRecord: defaultReadMergeReadinessRecord,
  writeMergeReadinessRecord: defaultWriteMergeReadinessRecord,
  readMergeLabelStatus: defaultReadMergeLabelStatus,
  writeMergeLabelVerdict: defaultWriteMergeLabelVerdict,
  runGh: defaultRunGh,
  env: process.env,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

function parseMergeMethod(value: string): MergeMethod {
  if (value === 'merge' || value === 'squash' || value === 'rebase') {
    return value;
  }
  throw new InvalidArgumentError('Merge method must be merge, squash, or rebase');
}

function handleMergeError(error: unknown, deps: MergeCommandDeps): void {
  if (error instanceof IssueIdError) {
    deps.write('stderr', `${error.message}\n`);
    deps.setExitCode(2);
    return;
  }

  if (error instanceof MergeReadinessError && error.code === 'no-pull-request') {
    deps.write('stderr', `${error.message}\n`);
    deps.setExitCode(2);
    return;
  }

  if (error instanceof MultipleMergeLabelVerdictsError) {
    deps.write('stderr', `${error.message}\n`);
    deps.setExitCode(4);
    return;
  }

  if (error instanceof MergeReadinessError && error.code === 'gh-error') {
    deps.write('stderr', `${error.message}\n`);
    deps.setExitCode(3);
    return;
  }

  throw error;
}

export async function mergeEvaluateAction(
  options: { issue?: number; printOnly?: boolean },
  deps: MergeCommandDeps = defaultDeps
): Promise<void> {
  try {
    const repoRoot = await deps.resolveRepoRoot(process.cwd());
    const repo = await deps.resolveRepoRef(process.cwd());
    const issueNumber = await deps.resolveIssueNumber(repoRoot, options.issue);
    const pullRequest = await deps.readPullRequestRecord(repoRoot);

    if (!pullRequest) {
      deps.write('stderr', `No pull request record for issue #${issueNumber}.\n`);
      deps.setExitCode(2);
      return;
    }

    if (options.printOnly) {
      const evaluation = await evaluateMergeReadinessLive(deps, repoRoot, repo, issueNumber);
      deps.write('stdout', buildMergeReadinessComment(evaluation, new Date().toISOString()));
      deps.setExitCode(evaluation.outcome === 'ready' ? 0 : 1);
      return;
    }

    const { evaluation: persistedEval, record } = await evaluateAndPersistMergeReadiness(
      deps,
      repoRoot,
      repo,
      issueNumber
    );

    const commentId = await syncMergePrComment(deps, repoRoot, repo, persistedEval, record);
    if (commentId && commentId !== record.prCommentId) {
      const updated: MergeReadinessRecord = { ...record, prCommentId: commentId };
      await deps.writeMergeReadinessRecord(repoRoot, updated);
    }

    deps.write(
      'stdout',
      `merge ${persistedEval.outcome} (issue #${issueNumber})\n`
    );

    if (persistedEval.outcome !== 'ready') {
      deps.write('stderr', `${persistedEval.nextAction}\n`);
      deps.setExitCode(1);
      return;
    }

    deps.setExitCode(0);
  } catch (error) {
    handleMergeError(error, deps);
  }
}

export async function mergeExecuteAction(
  options: { issue?: number; mergeMethod?: MergeMethod },
  deps: MergeCommandDeps = defaultDeps
): Promise<void> {
  try {
    const repoRoot = await deps.resolveRepoRoot(process.cwd());
    const repo = await deps.resolveRepoRef(process.cwd());
    const issueNumber = await deps.resolveIssueNumber(repoRoot, options.issue);
    const pullRequest = await deps.readPullRequestRecord(repoRoot);

    if (!pullRequest) {
      deps.write('stderr', `No pull request record for issue #${issueNumber}.\n`);
      deps.setExitCode(2);
      return;
    }

    const state = await deps.readState(repo, issueNumber);
    const engineEnabled = deps.env.ISSUEFLOW_ENGINE === '1';

    if (state === 'pr-ready' && !engineEnabled) {
      deps.write(
        'stderr',
        'issueflow merge is engine-only when transitioning pr-ready → merged. Set ISSUEFLOW_ENGINE=1.\n'
      );
      deps.setExitCode(3);
      return;
    }

    const { evaluation, merged } = await executeMerge(deps, repoRoot, repo, issueNumber, {
      mergeMethod: options.mergeMethod ?? 'merge',
      engineEnabled
    });

    if (!merged) {
      deps.write('stderr', `${evaluation.nextAction}\n`);
      deps.setExitCode(1);
      return;
    }

    deps.write('stdout', `merged PR #${pullRequest.prNumber} for issue #${issueNumber}\n`);
    deps.setExitCode(0);
  } catch (error) {
    if (error instanceof Error && !(error instanceof IssueIdError) && !(error instanceof MergeReadinessError)) {
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(1);
      return;
    }
    handleMergeError(error, deps);
  }
}

export async function mergeShowAction(
  options: { issue?: number },
  deps: MergeCommandDeps = defaultDeps
): Promise<void> {
  try {
    const repoRoot = await deps.resolveRepoRoot(process.cwd());
    await deps.resolveIssueNumber(repoRoot, options.issue);
    const record = await deps.readMergeReadinessRecord(repoRoot);

    if (!record) {
      deps.write('stderr', 'No merge readiness record found.\n');
      deps.setExitCode(2);
      return;
    }

    deps.write('stdout', `${JSON.stringify(record, null, 2)}\n`);
    deps.setExitCode(0);
  } catch (error) {
    handleMergeError(error, deps);
  }
}

export function registerMergeCommands(program: Command, deps: MergeCommandDeps = defaultDeps): void {
  const merge = program.command('merge').description('Evaluate and perform merge readiness checks');

  merge
    .command('evaluate')
    .description('Evaluate merge readiness and sync PR comment')
    .option('--issue <number>', 'Issue number', parseIssueNumber)
    .option('--print-only', 'Print checklist without persisting')
    .action((options) => mergeEvaluateAction(options, deps));

  merge
    .command('show')
    .description('Show merge readiness record')
    .option('--issue <number>', 'Issue number', parseIssueNumber)
    .action((options) => mergeShowAction(options, deps));

  merge
    .option('--issue <number>', 'Issue number', parseIssueNumber)
    .addOption(
      new Option('--merge-method <method>', 'gh pr merge method')
        .choices(['merge', 'squash', 'rebase'])
        .default('merge')
    )
    .action((options) =>
      mergeExecuteAction(
        { issue: options.issue, mergeMethod: parseMergeMethod(options.mergeMethod) },
        deps
      )
    );
}
