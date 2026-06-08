import { Command, InvalidArgumentError, Option } from 'commander';

import { execa } from 'execa';

import { parseGitHubRemote, readOriginRemote, resolveRepoRoot as defaultResolveRepoRoot } from '../core/git.js';
import { resolveIssueNumber as defaultResolveIssueNumber } from '../core/issue-id.js';
import { loadLatestRun as defaultLoadLatestRun } from '../verification/store.js';
import {
  MultipleVerdictLabelsError,
  readGateVerdictRecord as defaultReadGateVerdictRecord,
  readVerdict as defaultReadVerdict,
  type GateVerdictRecord,
  type VerdictStatus
} from '../verification/verdict-store.js';
import type { VerificationRun } from '../verification/types.js';
import { readState as defaultReadState, type RepoRef } from '../workflow/state-store.js';
import type { WorkflowState } from '../workflow/state-machine.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface PrCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  resolveIssueNumber: (repoRoot: string, override: number | undefined) => Promise<number>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  readVerdict: (repo: RepoRef, issueNumber: number) => Promise<VerdictStatus | null>;
  loadLatestRun: (repoRoot: string, issueNumber: number) => Promise<VerificationRun | null>;
  readGateVerdictRecord: (repoRoot: string, issueNumber: number) => Promise<GateVerdictRecord | null>;
  spawnGhPrCreate: (args: string[]) => Promise<void>;
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
      nextAction: 'Run `issueflow gate evaluate` to advance state.'
    };
  }

  if (input.verdict !== 'pass') {
    return {
      ok: false,
      reason: `Verification verdict must be "pass" (current: ${input.verdict ?? 'none'}).`,
      nextAction: 'Run `issueflow verify` then `issueflow gate evaluate`.'
    };
  }

  if (!input.latestRun || input.latestRun.status !== 'pass') {
    return {
      ok: false,
      reason: `Latest verification run did not pass (status: ${input.latestRun?.status ?? 'none'}).`,
      nextAction: 'Run `issueflow verify` then `issueflow gate evaluate`.'
    };
  }

  if (input.storedRunId === null) {
    return {
      ok: false,
      reason: 'No local gate verdict record exists for this issue.',
      nextAction: 'Run `issueflow gate evaluate` to record a verdict.'
    };
  }

  if (input.latestRun.runId !== input.storedRunId) {
    return {
      ok: false,
      reason: `Stale verdict: gate was evaluated for run ${input.storedRunId} but latest run is ${input.latestRun.runId}.`,
      nextAction: 'Run `issueflow gate evaluate` to refresh the verdict.'
    };
  }

  return { ok: true };
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

const defaultDeps: PrCommandDeps = {
  resolveRepoRoot: defaultResolveRepoRoot,
  resolveRepoRef: defaultResolveRepoRef,
  resolveIssueNumber: (repoRoot, override) => defaultResolveIssueNumber(repoRoot, override),
  readState: defaultReadState,
  readVerdict: defaultReadVerdict,
  loadLatestRun: defaultLoadLatestRun,
  readGateVerdictRecord: defaultReadGateVerdictRecord,
  spawnGhPrCreate: async (args) => {
    await execa('gh', ['pr', 'create', ...args], { stdio: 'inherit' });
  },
  write: (channel, message) => {
    if (channel === 'stdout') {
      process.stdout.write(message);
    } else {
      process.stderr.write(message);
    }
  },
  setExitCode: (code) => {
    process.exitCode = code;
  }
};

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}

export async function prCreateAction(
  options: { issue?: number; printOnly?: boolean },
  extraArgs: string[],
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
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(2);
    return;
  }

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
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(4);
      return;
    }
    throw error;
  }

  const gateResult = assertPrGate({
    state,
    verdict,
    latestRun,
    storedRunId: verdictRecord?.runId ?? null
  });

  if (!gateResult.ok) {
    deps.write('stderr', `Gate blocked: ${gateResult.reason}\n`);
    deps.write('stderr', `Next: ${gateResult.nextAction}\n`);
    deps.setExitCode(1);
    return;
  }

  if (options.printOnly) {
    deps.write('stdout', `Gate: PASS - verification cleared for issue #${issueNumber}.\n`);
    deps.write('stdout', `Would run: gh pr create ${extraArgs.join(' ')}\n`);
    deps.setExitCode(0);
    return;
  }

  await deps.spawnGhPrCreate(extraArgs);
}

export function registerPrCommands(program: Command, deps: PrCommandDeps = defaultDeps): Command {
  const pr = program.command('pr').description('Manage pull requests with gate enforcement');

  pr
    .command('create')
    .description('Create a pull request (gate-enforced)')
    .addOption(
      new Option(
        '--issue <number>',
        'Issue number (optional; falls back to session or branch)'
      ).argParser(parseIssueNumber)
    )
    .option('--print-only', 'Validate gate without creating the PR')
    .allowUnknownOption()
    .action(async (options: { issue?: number; printOnly?: boolean }, cmd: Command) => {
      const extraArgs = (cmd.args ?? []) as string[];
      await prCreateAction(options, extraArgs, deps);
    });

  return pr;
}
