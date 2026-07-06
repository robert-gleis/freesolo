import { Command } from 'commander';

import { resolveRepoRef, resolveRepoRoot } from '../core/git.js';
import { IssueIdError, resolveIssueNumber } from '../core/issue-id.js';
import type { RepoRef } from '../core/types.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import {
  MalformedStateError,
  initializeState as defaultInitializeState,
  readState as defaultReadState
} from '../workflow/local-state-store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface OrchestrateCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  resolveIssueNumber: (repoRoot: string, override: number | undefined) => Promise<number>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  initializeState: (repo: RepoRef, issueNumber: number, state: WorkflowState) => Promise<void>;
  /** Run a freesolo subcommand with FREESOLO_ENGINE=1 and return its exit code. */
  runStep: (args: string[]) => Promise<number>;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

async function defaultRunStep(args: string[]): Promise<number> {
  // Lazy import: cli.ts imports this module, so a static import would be a cycle.
  const { buildCli } = await import('../cli.js');
  process.stdout.write(`\n» freesolo ${args.join(' ')}\n`);
  const previousEngine = process.env.FREESOLO_ENGINE;
  const previousExitCode = process.exitCode;
  process.env.FREESOLO_ENGINE = '1';
  process.exitCode = 0;
  try {
    await buildCli().parseAsync(args, { from: 'user' });
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } finally {
    process.exitCode = previousExitCode;
    if (previousEngine === undefined) {
      delete process.env.FREESOLO_ENGINE;
    } else {
      process.env.FREESOLO_ENGINE = previousEngine;
    }
  }
}

const defaultDeps: OrchestrateCommandDeps = {
  resolveRepoRoot,
  resolveRepoRef,
  resolveIssueNumber: (repoRoot, override) => resolveIssueNumber(repoRoot, override),
  readState: defaultReadState,
  initializeState: defaultInitializeState,
  runStep: defaultRunStep,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

function withCommanderErrorHandling(
  deps: OrchestrateCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);

    if (error instanceof IssueIdError) {
      deps.setExitCode(2);
      return;
    }

    if (error instanceof MalformedStateError) {
      deps.setExitCode(4);
      return;
    }

    deps.setExitCode(1);
  });
}

async function resolveIssueContext(
  deps: OrchestrateCommandDeps,
  issueOverride: number | undefined
): Promise<{ issueNumber: number; repo: RepoRef; repoRoot: string }> {
  const repoRoot = await deps.resolveRepoRoot(process.cwd());
  const issueNumber = await deps.resolveIssueNumber(repoRoot, issueOverride);
  const repo = await deps.resolveRepoRef(process.cwd());
  return { issueNumber, repo, repoRoot };
}

export async function planAutoAction(
  issueArg: number | undefined,
  options: { edit?: boolean },
  deps: OrchestrateCommandDeps = defaultDeps
): Promise<void> {
  await withCommanderErrorHandling(deps, async () => {
    const { issueNumber, repo } = await resolveIssueContext(deps, issueArg);
    const issue = String(issueNumber);

    let state = await deps.readState(repo, issueNumber);
    if (state === null) {
      await deps.initializeState(repo, issueNumber, 'triaged');
      state = 'triaged';
      deps.write('stdout', `issue #${issueNumber} initialised at "triaged"\n`);
    }

    if (state === 'triaged') {
      const code = await deps.runStep(['plan', 'generate', '--issue', issue]);
      if (code !== 0) {
        deps.setExitCode(code);
        return;
      }
      state = (await deps.readState(repo, issueNumber)) ?? state;
    }

    if (state === 'planned') {
      if (options.edit) {
        const code = await deps.runStep(['plan', 'edit', '--issue', issue]);
        if (code !== 0) {
          deps.setExitCode(code);
          return;
        }
      } else {
        await deps.runStep(['plan', 'show', '--issue', issue]);
      }
      const code = await deps.runStep(['plan', 'approve', '--issue', issue]);
      if (code !== 0) {
        deps.setExitCode(code);
        return;
      }
      state = 'approved';
    }

    if (state === 'approved') {
      deps.write('stdout', `\nplan approved — next: freesolo work ${issueNumber}\n`);
      return;
    }

    deps.write(
      'stdout',
      `issue #${issueNumber} is already "${state}" — nothing left to plan. Next: freesolo work ${issueNumber}\n`
    );
  });
}

export function registerOrchestrateCommands(
  plan: Command,
  deps: OrchestrateCommandDeps = defaultDeps
): void {
  plan
    .command('auto', { isDefault: true })
    .description('Plan an issue end-to-end: initialise state, generate the team plan, approve it')
    .argument('[issue]', 'Issue number (falls back to the worktree issue packet)', parseIssueNumber)
    .option('--edit', 'Open the generated plan in $EDITOR before approving')
    .action(async (issue: number | undefined, options: { edit?: boolean }) => {
      await planAutoAction(issue, options, deps);
    });
}
