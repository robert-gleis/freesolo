import { Command, Option } from 'commander';

import { resolveRepoRef } from '../core/git.js';
import {
  InvalidTransitionError,
  WORKFLOW_STATES,
  type WorkflowState
} from '../workflow/state-machine.js';
import type { RepoRef } from '../core/types.js';
import {
  MalformedStateError,
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/local-state-store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface StateCommandDeps {
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  writeState: (
    repo: RepoRef,
    issueNumber: number,
    from: WorkflowState,
    to: WorkflowState
  ) => Promise<void>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: StateCommandDeps = {
  resolveRepoRef,
  readState: defaultReadState,
  writeState: defaultWriteState,
  env: process.env,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

function isKnownWorkflowState(value: string): value is WorkflowState {
  return (WORKFLOW_STATES as readonly string[]).includes(value);
}

function withCommanderErrorHandling(
  _command: Command,
  deps: StateCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);

    if (error instanceof MalformedStateError) {
      deps.setExitCode(4);
      return;
    }

    deps.setExitCode(1);
  });
}

export function registerStateCommands(program: Command, deps: StateCommandDeps = defaultDeps): Command {
  const state = program
    .command('state')
    .description('Inspect and advance the FreeSolo workflow state for a GitHub issue');

  state
    .command('get')
    .description('Print the current workflow state for the given issue')
    .addOption(
      new Option('--issue <number>', 'Issue number to inspect')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .action(async (options: { issue: number }) => {
      await withCommanderErrorHandling(state, deps, async () => {
        const repo = await deps.resolveRepoRef(process.cwd());
        const current = await deps.readState(repo, options.issue);
        if (current === null) {
          deps.write('stdout', 'null\n');
          deps.setExitCode(2);
          return;
        }
        deps.write('stdout', `${current}\n`);
      });
    });

  state
    .command('transition')
    .description('Advance the workflow state for an issue (engine-only)')
    .addOption(
      new Option('--issue <number>', 'Issue number to transition')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .requiredOption('--to <state>', 'Target workflow state')
    .action(async (options: { issue: number; to: string }) => {
      if (deps.env.FREESOLO_ENGINE !== '1') {
        deps.write(
          'stderr',
          'freesolo state transition is engine-only. Set FREESOLO_ENGINE=1 to authorise the call; agent processes must not bypass the workflow engine.\n'
        );
        deps.setExitCode(3);
        return;
      }

      if (!isKnownWorkflowState(options.to)) {
        deps.write(
          'stderr',
          `Unknown state "${options.to}". Known states: ${WORKFLOW_STATES.join(', ')}.\n`
        );
        deps.setExitCode(1);
        return;
      }

      const target: WorkflowState = options.to;

      await withCommanderErrorHandling(state, deps, async () => {
        const repo = await deps.resolveRepoRef(process.cwd());
        const current = await deps.readState(repo, options.issue);
        if (current === null) {
          deps.write(
            'stderr',
            `Issue #${options.issue} has no current workflow state. Initialise it before transitioning.\n`
          );
          deps.setExitCode(1);
          return;
        }

        try {
          await deps.writeState(repo, options.issue, current, target);
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            deps.write('stderr', `${error.message}\n`);
            deps.setExitCode(1);
            return;
          }
          throw error;
        }

        deps.write('stdout', `${current} -> ${target}\n`);
      });
    });

  return state;
}
