import { Command, Option } from 'commander';

import { resolveRepoRef } from '../core/git.js';
import {
  createWorkflowEngine,
  type TickResult,
  type WorkflowEngineDeps
} from '../workflow/engine.js';
import { defaultPolicy } from '../workflow/policy.js';
import type { RepoRef } from '../core/types.js';
import {
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/local-state-store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface EngineCommandDeps {
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  tick: (input: { repo: RepoRef; issueNumber: number }) => Promise<TickResult>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultEngineDeps: WorkflowEngineDeps = {
  readState: defaultReadState,
  writeState: defaultWriteState,
  policy: defaultPolicy
};

const defaultDeps: EngineCommandDeps = {
  resolveRepoRef,
  tick: (input) => createWorkflowEngine(defaultEngineDeps).tick(input),
  env: process.env,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

const REFUSAL_EXIT_CODES: Record<NonNullable<TickResult['refused']>['code'], number> = {
  'no-state': 2,
  'terminal-state': 2,
  'policy-refused': 2,
  'invalid-transition': 1,
  'no-agent-adapter': 1,
  'malformed-state': 4
};

function formatSuccess(result: TickResult): string {
  if (result.action.kind === 'wait') {
    return `${result.fromState} (wait: ${result.action.reason})\n`;
  }
  if (result.action.kind === 'transition') {
    return `${result.fromState} -> ${result.toState} (transition)\n`;
  }
  if (result.action.kind === 'spawn') {
    return `${result.fromState} -> ${result.toState} (spawn -> ${result.action.nextState})\n`;
  }
  throw new Error(
    'formatSuccess called with a refuse action — formatRefusal should have handled this'
  );
}

function formatRefusal(result: TickResult): string {
  const refused = result.refused;
  if (!refused) {
    return '';
  }
  return `engine refused (${refused.code}): ${refused.reason}\n`;
}

function withCommanderErrorHandling(
  _command: Command,
  deps: EngineCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(1);
  });
}

export function registerEngineCommands(
  program: Command,
  deps: EngineCommandDeps = defaultDeps
): Command {
  const engine = program
    .command('engine')
    .description('Drive an issue through the FreeSolo workflow engine');

  engine
    .command('tick')
    .description('Advance one issue by reading state, asking the policy, and writing the result')
    .addOption(
      new Option('--issue <number>', 'Issue number to tick')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .action(async (options: { issue: number }) => {
      if (deps.env.FREESOLO_ENGINE !== '1') {
        deps.write(
          'stderr',
          'freesolo engine tick is engine-only. Set FREESOLO_ENGINE=1 to authorise the call.\n'
        );
        deps.setExitCode(3);
        return;
      }

      await withCommanderErrorHandling(engine, deps, async () => {
        const repo = await deps.resolveRepoRef(process.cwd());
        const result = await deps.tick({ repo, issueNumber: options.issue });

        if (result.refused) {
          deps.write('stderr', formatRefusal(result));
          deps.setExitCode(REFUSAL_EXIT_CODES[result.refused.code]);
          return;
        }

        deps.write('stdout', formatSuccess(result));
      });
    });

  return engine;
}
