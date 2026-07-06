import fs from 'node:fs/promises';

import { Command, InvalidArgumentError, Option } from 'commander';

import { IssueIdError } from '../core/issue-id.js';
import {
  resolveRepoRef as defaultResolveRepoRef,
  resolveRepoRoot as defaultResolveRepoRoot
} from '../core/git.js';
import {
  createPullRequest as defaultCreatePullRequest,
  defaultRunGh,
  defaultRunGit,
  readPullRequestRecord as defaultReadPullRequestRecord,
  PullRequestError,
  type PullRequestOutcome
} from '../integration/index.js';
import { loadLatestRun as defaultLoadLatestRun } from '../verification/store.js';
import {
  MultipleVerdictLabelsError,
  readGateVerdictRecord as defaultReadGateVerdictRecord,
  readVerdict as defaultReadVerdict,
  type GateVerdictRecord,
  type VerdictStatus
} from '../verification/verdict-store.js';
import type { VerificationRun } from '../verification/types.js';
import { readState as defaultReadState } from '../workflow/local-state-store.js';
import type { RepoRef } from '../core/types.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface PrCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  resolveIssueNumber: (repoRoot: string, override: number | undefined) => Promise<number>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  readVerdict: (repo: RepoRef, issueNumber: number) => Promise<VerdictStatus | null>;
  loadLatestRun: (repoRoot: string, issueNumber: number) => Promise<VerificationRun | null>;
  readGateVerdictRecord: (repoRoot: string, issueNumber: number) => Promise<GateVerdictRecord | null>;
  createPullRequest: typeof defaultCreatePullRequest;
  readPullRequestRecord: typeof defaultReadPullRequestRecord;
  runGh: typeof defaultRunGh;
  runGit: typeof defaultRunGit;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

export interface PrGateInput {
  state: WorkflowState | null;
  verdict: VerdictStatus | null;
  latestRun: VerificationRun | null;
  storedRunId: string | null;
}

export type PrGateResult = { ok: true } | { ok: false; reason: string; nextAction: string };

export function assertPrGate(input: PrGateInput): PrGateResult {
  if (input.state !== 'pr-ready') {
    return {
      ok: false,
      reason: `Issue must be in state "pr-ready" to create a PR (current: ${input.state ?? 'none'}).`,
      nextAction: 'Run `freesolo gate evaluate` to advance state.'
    };
  }

  if (input.verdict !== 'pass') {
    return {
      ok: false,
      reason: `Verification verdict must be "pass" (current: ${input.verdict ?? 'none'}).`,
      nextAction: 'Run `freesolo verify` then `freesolo gate evaluate`.'
    };
  }

  if (!input.latestRun || input.latestRun.status !== 'pass') {
    return {
      ok: false,
      reason: `Latest verification run did not pass (status: ${input.latestRun?.status ?? 'none'}).`,
      nextAction: 'Run `freesolo verify` then `freesolo gate evaluate`.'
    };
  }

  if (input.storedRunId === null) {
    return {
      ok: false,
      reason: 'No local gate verdict record exists for this issue.',
      nextAction: 'Run `freesolo gate evaluate` to record a verdict.'
    };
  }

  if (input.latestRun.runId !== input.storedRunId) {
    return {
      ok: false,
      reason: `Stale verdict: gate was evaluated for run ${input.storedRunId} but latest run is ${input.latestRun.runId}.`,
      nextAction: 'Run `freesolo gate evaluate` to refresh the verdict.'
    };
  }

  return { ok: true };
}

const defaultDeps: PrCommandDeps = {
  resolveRepoRoot: defaultResolveRepoRoot,
  resolveRepoRef: defaultResolveRepoRef,
  resolveIssueNumber: async (repoRoot, override) => {
    const { resolveIssueNumber } = await import('../core/issue-id.js');
    return resolveIssueNumber(repoRoot, override);
  },
  readState: defaultReadState,
  readVerdict: defaultReadVerdict,
  loadLatestRun: defaultLoadLatestRun,
  readGateVerdictRecord: defaultReadGateVerdictRecord,
  createPullRequest: defaultCreatePullRequest,
  readPullRequestRecord: defaultReadPullRequestRecord,
  runGh: defaultRunGh,
  runGit: defaultRunGit,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

function mapPullRequestError(error: PullRequestError): number {
  switch (error.code) {
    case 'candidate-not-ready':
    case 'verification-not-passed':
    case 'review-artifact-missing':
    case 'summary-unavailable':
      return 1;
    case 'gh-error':
    case 'git-error':
      return 3;
    default:
      return 2;
  }
}

function printOutcome(outcome: PullRequestOutcome, deps: PrCommandDeps): void {
  if (outcome.status === 'dry-run') {
    deps.write('stdout', `Title: ${outcome.title}\n`);
    deps.write('stdout', `Head: ${outcome.headBranch}\n`);
    deps.write('stdout', `Base: ${outcome.baseBranch}\n`);
    deps.write('stdout', `${outcome.body}\n`);
    return;
  }

  deps.write('stdout', `${JSON.stringify(outcome.record, null, 2)}\n`);
}

async function evaluateGate(
  deps: PrCommandDeps,
  repo: RepoRef,
  repoRoot: string,
  issueNumber: number
): Promise<PrGateResult | { error: 'multiple-labels'; message: string }> {
  let state: WorkflowState | null;
  let verdict: VerdictStatus | null;
  let latestRun: VerificationRun | null;
  let verdictRecord: GateVerdictRecord | null;

  try {
    [state, verdict, latestRun, verdictRecord] = await Promise.all([
      deps.readState(repo, issueNumber),
      deps.readVerdict(repo, issueNumber),
      deps.loadLatestRun(repoRoot, issueNumber),
      deps.readGateVerdictRecord(repoRoot, issueNumber)
    ]);
  } catch (error) {
    if (error instanceof MultipleVerdictLabelsError) {
      return { error: 'multiple-labels', message: error.message };
    }
    throw error;
  }

  return assertPrGate({
    state,
    verdict,
    latestRun,
    storedRunId: verdictRecord?.runId ?? null
  });
}

export async function prCreateAction(
  options: { issue?: number; base?: string; printOnly?: boolean; dryRun?: boolean },
  deps: PrCommandDeps = defaultDeps
): Promise<void> {
  let repoRoot: string;
  let repo: RepoRef;
  let issueNumber: number;

  try {
    repoRoot = await deps.resolveRepoRoot(process.cwd());
    repo = await deps.resolveRepoRef(process.cwd());
    issueNumber = await deps.resolveIssueNumber(repoRoot, options.issue);
  } catch (error) {
    const message = error instanceof IssueIdError || error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(2);
    return;
  }

  const gateEvaluation = await evaluateGate(deps, repo, repoRoot, issueNumber);
  if ('error' in gateEvaluation) {
    deps.write('stderr', `${gateEvaluation.message}\n`);
    deps.setExitCode(4);
    return;
  }

  if (!gateEvaluation.ok) {
    deps.write('stderr', `Gate blocked: ${gateEvaluation.reason}\n`);
    deps.write('stderr', `Next: ${gateEvaluation.nextAction}\n`);
    deps.setExitCode(1);
    return;
  }

  if (options.printOnly && !options.dryRun) {
    deps.write('stdout', `Gate: PASS - verification cleared for issue #${issueNumber}.\n`);
    deps.write('stdout', 'Would create pull request from verified candidate branch.\n');
    deps.setExitCode(0);
    return;
  }

  try {
    const outcome = await deps.createPullRequest(
      {
        repoRoot,
        issueNumber,
        baseBranch: options.base,
        dryRun: options.dryRun ?? false
      },
      {
        runGh: deps.runGh,
        runGit: deps.runGit,
        readFile: fs.readFile,
        writeFile: fs.writeFile
      }
    );

    if (options.dryRun) {
      deps.write('stdout', `Gate: PASS - verification cleared for issue #${issueNumber}.\n`);
    }

    printOutcome(outcome, deps);
    deps.setExitCode(0);
  } catch (error) {
    if (error instanceof PullRequestError) {
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(mapPullRequestError(error));
      return;
    }

    throw error;
  }
}

export async function showAction(
  options: { issue?: number },
  deps: PrCommandDeps = defaultDeps
): Promise<void> {
  let repoRoot: string;
  let issueNumber: number;

  try {
    repoRoot = await deps.resolveRepoRoot(process.cwd());
    issueNumber = await deps.resolveIssueNumber(repoRoot, options.issue);
  } catch (error) {
    if (error instanceof IssueIdError) {
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(2);
      return;
    }

    throw error;
  }

  try {
    const record = await deps.readPullRequestRecord(repoRoot);

    if (!record || record.issueNumber !== issueNumber) {
      deps.write('stderr', `No pull request provenance found for issue #${issueNumber}.\n`);
      deps.setExitCode(2);
      return;
    }

    deps.write('stdout', `${JSON.stringify(record, null, 2)}\n`);
    deps.setExitCode(0);
  } catch (error) {
    if (error instanceof PullRequestError) {
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(2);
      return;
    }

    throw error;
  }
}

export function registerPrCommands(program: Command, deps: PrCommandDeps = defaultDeps): Command {
  const pr = program.command('pr').description('Create and inspect pull requests from verified candidate branches');

  pr
    .command('create')
    .description('Create a pull request after the verification gate passes')
    .addOption(
      new Option('--issue <number>', 'Issue number (optional; falls back to session or branch)').argParser(
        parseIssueNumber
      )
    )
    .option('--base <branch>', 'Base branch for the pull request')
    .option('--print-only', 'Validate gate without creating the PR')
    .option('--dry-run', 'Validate gate and print the resolved PR title and body')
    .action(async (options: { issue?: number; base?: string; printOnly?: boolean; dryRun?: boolean }) => {
      await prCreateAction(options, deps);
    });

  pr.command('show')
    .description('Show pull request provenance for an issue')
    .option('--issue <number>', 'Issue id to show pull request provenance for', (value) => {
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`--issue must be a positive integer (got "${value}").`);
      }
      return Number.parseInt(value, 10);
    })
    .action((options) => showAction(options, deps));

  return pr;
}
