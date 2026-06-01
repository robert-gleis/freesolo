import { Command, InvalidArgumentError, Option } from 'commander';

import { parseGitHubRemote, readOriginRemote, resolveRepoRoot } from '../core/git.js';
import {
  createWorkflowEngine,
  type TickResult,
  type WorkflowEngineDeps
} from '../workflow/engine.js';
import { defaultPolicy } from '../workflow/policy.js';
import {
  readState as defaultReadState,
  writeState as defaultWriteState,
  type RepoRef
} from '../workflow/state-store.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface EngineCommandDeps {
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  tick: (input: { repo: RepoRef; issueNumber: number }) => Promise<TickResult>;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

async function defaultResolveRepoRef(cwd: string): Promise<RepoRef> {
  const repoRoot = await resolveRepoRoot(cwd);
  const remoteUrl = await readOriginRemote(repoRoot);
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error('origin is not a supported GitHub remote');
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

const defaultEngineDeps: WorkflowEngineDeps = {
  readState: defaultReadState,
  writeState: defaultWriteState,
  policy: defaultPolicy
};

const defaultDeps: EngineCommandDeps = {
  resolveRepoRef: defaultResolveRepoRef,
  tick: (input) => createWorkflowEngine(defaultEngineDeps).tick(input),
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
  }
};

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}

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
    .description('Drive an issue through the IssueFlow workflow engine');

  engine
    .command('tick')
    .description('Advance one issue by reading state, asking the policy, and writing the result')
    .addOption(
      new Option('--issue <number>', 'Issue number to tick')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .action(async (options: { issue: number }) => {
      if (deps.env.ISSUEFLOW_ENGINE !== '1') {
        deps.write(
          'stderr',
          'issueflow engine tick is engine-only. Set ISSUEFLOW_ENGINE=1 to authorise the call.\n'
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
