import { confirm } from '@inquirer/prompts';
import { Command, InvalidArgumentError, Option } from 'commander';

import { defaultConfigPath, loadConfig as defaultLoadConfig } from '../config/load.js';
import {
  MIN_INTERVAL_SECONDS,
  type IssueflowConfig,
  type WatcherConfig,
  type WatcherIntakeMode,
  type WatcherSource
} from '../config/types.js';
import { parseGitHubRemote, readOriginRemote, resolveRepoRoot } from '../core/git.js';
import { defaultStateDbPath, openStateDb as defaultOpenStateDb, type StateDb } from '../state/db.js';
import { pollIssues } from '../watcher/poll.js';
import { runWatchCycle as defaultRunWatchCycle, runWatchLoop as defaultRunWatchLoop } from '../watcher/runner.js';
import {
  createWorkflowEngine,
  type TickResult,
  type WorkflowEngineDeps
} from '../workflow/engine.js';
import { defaultPolicy } from '../workflow/policy.js';
import {
  defaultRunner,
  type RepoRef
} from '../workflow/state-store.js';
import {
  initializeState as defaultInitializeState,
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/configurable-state.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import type { WatchIssue } from '../watcher/poll.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface WatchCommandDeps {
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  loadConfig: (configPath?: string) => Promise<IssueflowConfig>;
  openStateDb: (dbPath?: string) => Promise<StateDb>;
  runWatchCycle: typeof defaultRunWatchCycle;
  runWatchLoop: typeof defaultRunWatchLoop;
  confirmIntake: (issue: WatchIssue) => Promise<boolean>;
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

const defaultDeps: WatchCommandDeps = {
  resolveRepoRef: defaultResolveRepoRef,
  loadConfig: defaultLoadConfig,
  openStateDb: defaultOpenStateDb,
  runWatchCycle: defaultRunWatchCycle,
  runWatchLoop: defaultRunWatchLoop,
  confirmIntake: (issue) =>
    confirm({ message: `Start issue #${issue.number} "${issue.title}"?`, default: false }),
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

function parseIntervalSeconds(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < MIN_INTERVAL_SECONDS) {
    throw new InvalidArgumentError(`interval must be an integer >= ${MIN_INTERVAL_SECONDS}`);
  }
  return parsed;
}

function parseSource(value: string): WatcherSource {
  if (value !== 'assigned-to-me' && value !== 'label') {
    throw new InvalidArgumentError('source must be "assigned-to-me" or "label"');
  }
  return value;
}

function parseIntakeMode(value: string): WatcherIntakeMode {
  if (value !== 'confirm' && value !== 'auto') {
    throw new InvalidArgumentError('intake mode must be "confirm" or "auto"');
  }
  return value;
}

interface WatcherOverrideOptions {
  source?: WatcherSource;
  intakeMode?: WatcherIntakeMode;
  triggerLabel?: string;
}

function resolveWatcherConfig(config: IssueflowConfig, options: WatcherOverrideOptions): WatcherConfig {
  return {
    ...config.watcher,
    source: options.source ?? (options.triggerLabel ? 'label' : config.watcher.source),
    intake_mode: options.intakeMode ?? config.watcher.intake_mode,
    initial_state: config.watcher.initial_state,
    trigger_label: options.triggerLabel ?? config.watcher.trigger_label
  };
}

function withCommanderErrorHandling(
  _command: Command,
  deps: WatchCommandDeps,
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

function applyCycleExitCode(
  deps: WatchCommandDeps,
  result: { failed: number; pollError?: string }
): void {
  if (result.pollError) {
    deps.write('stderr', `${result.pollError}\n`);
  }
  if (result.failed > 0 || result.pollError) {
    deps.setExitCode(1);
  }
}

async function buildCycleDeps(
  deps: WatchCommandDeps,
  db: StateDb,
  repo: RepoRef,
  watcher: WatcherConfig,
  sinceOverride?: string
) {
  return {
    db,
    repo,
    source: watcher.source,
    intakeMode: watcher.intake_mode,
    initialState: watcher.initial_state,
    triggerLabel: watcher.trigger_label,
    sinceOverride,
    poll: (since: string) =>
      pollIssues({
        repo,
        source: watcher.source,
        since,
        triggerLabel: watcher.trigger_label,
        gh: defaultRunner,
        onWarn: (message) => deps.write('stderr', `${message}\n`)
      }),
    confirmIntake: deps.confirmIntake,
    readState: defaultReadState,
    initializeState: (input: { repo: RepoRef; issueNumber: number; initialState: WorkflowState }) =>
      defaultInitializeState(input.repo, input.issueNumber, input.initialState),
    tick: (input: { repo: RepoRef; issueNumber: number }): Promise<TickResult> =>
      createWorkflowEngine(defaultEngineDeps).tick(input)
  };
}

export function registerWatchCommands(
  program: Command,
  deps: WatchCommandDeps = defaultDeps
): Command {
  const watch = program
    .command('watch')
    .description('Poll GitHub for triaged issues and drain them through the workflow engine');

  watch
    .command('run')
    .description('Poll continuously until SIGINT/SIGTERM (graceful shutdown finishes current cycle)')
    .addOption(new Option('--interval <seconds>', 'Polling interval override').argParser(parseIntervalSeconds))
    .addOption(new Option('--source <source>', 'Issue source override').argParser(parseSource))
    .addOption(new Option('--intake-mode <mode>', 'Intake mode override').argParser(parseIntakeMode))
    .addOption(new Option('--trigger-label <label>', 'Trigger label override'))
    .action(async (options: WatcherOverrideOptions & { interval?: number }) => {
      if (deps.env.ISSUEFLOW_ENGINE !== '1') {
        deps.write(
          'stderr',
          'issueflow watch run is engine-only. Set ISSUEFLOW_ENGINE=1 to authorise the call.\n'
        );
        deps.setExitCode(3);
        return;
      }

      await withCommanderErrorHandling(watch, deps, async () => {
        const config = await deps.loadConfig(defaultConfigPath());
        const intervalSeconds = options.interval ?? config.watcher.interval_seconds;
        const watcher = resolveWatcherConfig(config, options);
        const repo = await deps.resolveRepoRef(process.cwd());
        const db = await deps.openStateDb(defaultStateDbPath());

        const controller = new AbortController();
        const onSignal = () => controller.abort();
        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);

        try {
          const cycleDeps = await buildCycleDeps(deps, db, repo, watcher);
          await deps.runWatchLoop({
            ...cycleDeps,
            intervalMs: intervalSeconds * 1000,
            signal: controller.signal,
            onCycleResult: (result) => {
              if (result.pollError) {
                deps.write('stderr', `${result.pollError}\n`);
              }
            }
          });
        } finally {
          process.removeListener('SIGINT', onSignal);
          process.removeListener('SIGTERM', onSignal);
          db.close();
        }
      });
    });

  watch
    .command('once')
    .description('Run a single poll + drain cycle')
    .addOption(new Option('--since <iso8601>', 'Override cursor for this run only'))
    .addOption(new Option('--source <source>', 'Issue source override').argParser(parseSource))
    .addOption(new Option('--intake-mode <mode>', 'Intake mode override').argParser(parseIntakeMode))
    .addOption(new Option('--trigger-label <label>', 'Trigger label override'))
    .action(async (options: WatcherOverrideOptions & { since?: string }) => {
      await withCommanderErrorHandling(watch, deps, async () => {
        const config = await deps.loadConfig(defaultConfigPath());
        const watcher = resolveWatcherConfig(config, options);
        const repo = await deps.resolveRepoRef(process.cwd());
        const db = await deps.openStateDb(defaultStateDbPath());

        try {
          const cycleDeps = await buildCycleDeps(deps, db, repo, watcher, options.since);
          const result = await deps.runWatchCycle(cycleDeps);
          applyCycleExitCode(deps, result);
        } finally {
          db.close();
        }
      });
    });

  return watch;
}
