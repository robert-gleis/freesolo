import { Command, InvalidArgumentError, Option } from 'commander';

import { parseGitHubRemote, readOriginRemote, resolveRepoRoot as defaultResolveRepoRoot } from '../core/git.js';
import { resolveIssueNumber as defaultResolveIssueNumber } from '../core/issue-id.js';
import { evaluateGate } from '../verification/gate.js';
import { loadLatestRun as defaultLoadLatestRun } from '../verification/store.js';
import {
  MultipleVerdictLabelsError,
  readVerdict as defaultReadVerdict,
  writeVerdict as defaultWriteVerdict,
  writeGateVerdictRecord as defaultWriteGateVerdictRecord,
  type GateVerdictRecord,
  type VerdictStatus
} from '../verification/verdict-store.js';
import type { VerificationRun } from '../verification/types.js';
import {
  readState as defaultReadState,
  writeState as defaultWriteState,
  type RepoRef
} from '../workflow/state-store.js';
import type { WorkflowState } from '../workflow/state-machine.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface GateCommandDeps {
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
  writeVerdict: (
    repo: RepoRef,
    issueNumber: number,
    from: VerdictStatus | null,
    to: VerdictStatus
  ) => Promise<void>;
  loadLatestRun: (repoRoot: string, issueNumber: number) => Promise<VerificationRun | null>;
  writeGateVerdictRecord: (
    repoRoot: string,
    issueNumber: number,
    record: GateVerdictRecord
  ) => Promise<void>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
  now: () => Date;
}

async function defaultResolveRepoRef(cwd: string): Promise<RepoRef> {
  const repoRoot = await defaultResolveRepoRoot(cwd);
  const remoteUrl = await readOriginRemote(repoRoot);
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error('origin is not a supported GitHub remote');
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

const defaultDeps: GateCommandDeps = {
  resolveRepoRoot: defaultResolveRepoRoot,
  resolveRepoRef: defaultResolveRepoRef,
  resolveIssueNumber: (repoRoot, override) => defaultResolveIssueNumber(repoRoot, override),
  readState: defaultReadState,
  writeState: defaultWriteState,
  readVerdict: defaultReadVerdict,
  writeVerdict: defaultWriteVerdict,
  loadLatestRun: defaultLoadLatestRun,
  writeGateVerdictRecord: defaultWriteGateVerdictRecord,
  env: process.env,
  write: (channel, message) => {
    if (channel === 'stdout') {
      process.stdout.write(message);
    } else {
      process.stderr.write(message);
    }
  },
  setExitCode: (code) => {
    process.exitCode = code;
  },
  now: () => new Date()
};

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}

export async function gateEvaluateAction(
  options: { issue?: number },
  deps: GateCommandDeps = defaultDeps
): Promise<void> {
  if (deps.env.ISSUEFLOW_ENGINE !== '1') {
    deps.write(
      'stderr',
      'issueflow gate evaluate is engine-only. Set ISSUEFLOW_ENGINE=1 to authorise the call.\n'
    );
    deps.setExitCode(3);
    return;
  }

  let repoRoot: string;
  let repo: RepoRef;
  let issueNumber: number;

  try {
    repoRoot = await deps.resolveRepoRoot(process.cwd());
    repo = await deps.resolveRepoRef(process.cwd());
    issueNumber = await deps.resolveIssueNumber(repoRoot, options.issue);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(2);
    return;
  }

  const state = await deps.readState(repo, issueNumber);

  if (state !== 'verifying') {
    deps.write(
      'stderr',
      `Issue #${issueNumber} must be in state "verifying" to evaluate gate (current: ${state ?? 'none'}).\n`
    );
    deps.setExitCode(2);
    return;
  }

  const latestRun = await deps.loadLatestRun(repoRoot, issueNumber);
  const evaluation = evaluateGate(latestRun);

  if (evaluation.outcome === 'no-run') {
    deps.write('stderr', `${evaluation.nextAction}\n`);
    deps.setExitCode(2);
    return;
  }

  let currentVerdict: VerdictStatus | null;
  try {
    currentVerdict = await deps.readVerdict(repo, issueNumber);
  } catch (error) {
    if (error instanceof MultipleVerdictLabelsError) {
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(4);
      return;
    }
    throw error;
  }

  await deps.writeVerdict(repo, issueNumber, currentVerdict, evaluation.outcome as VerdictStatus);

  const record: GateVerdictRecord = {
    schemaVersion: 1,
    issueNumber,
    runId: evaluation.runId!,
    outcome: evaluation.outcome,
    reason: evaluation.reason,
    nextAction: evaluation.nextAction,
    evaluatedAt: deps.now().toISOString()
  };
  await deps.writeGateVerdictRecord(repoRoot, issueNumber, record);

  const targetState: WorkflowState = evaluation.outcome === 'pass' ? 'pr-ready' : 'implementing';
  await deps.writeState(repo, issueNumber, 'verifying', targetState);

  deps.write('stdout', `Gate: ${evaluation.outcome.toUpperCase()} - ${evaluation.reason}\n`);
  deps.write('stdout', `State: verifying -> ${targetState}\n`);
  if (evaluation.outcome === 'fail') {
    deps.write('stderr', `${evaluation.nextAction}\n`);
  }
  deps.setExitCode(evaluation.outcome === 'pass' ? 0 : 1);
}

export function registerGateCommands(program: Command, deps: GateCommandDeps = defaultDeps): Command {
  const gate = program.command('gate').description('Evaluate the verification gate and record the verdict');

  gate
    .command('evaluate')
    .description('Evaluate the verification gate for an issue (engine-only)')
    .addOption(
      new Option(
        '--issue <number>',
        'Issue number (optional; falls back to session or branch)'
      ).argParser(parseIssueNumber)
    )
    .action(async (options: { issue?: number }) => {
      await gateEvaluateAction(options, deps);
    });

  return gate;
}
