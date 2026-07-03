import { Command } from 'commander';

import {
  defaultConfigPath,
  loadConfigWithOrigins,
  repoConfigPath as defaultRepoConfigPath,
  type ConfigWithOrigins
} from '../config/load.js';
import { isWatcherIntakeMode, isWatcherSource } from '../config/types.js';
import { initConfigFile as defaultInitConfigFile, setConfigKey as defaultSetConfigKey } from '../config/write.js';
import { resolveRepoRoot } from '../core/git.js';
import { isNonTerminalWorkflowState } from '../workflow/state-machine.js';

export interface ConfigCommandDeps {
  loadConfigWithOrigins: (globalPath?: string, repoRoot?: string) => Promise<ConfigWithOrigins>;
  setConfigKey: (filePath: string, key: string, value: string) => Promise<void>;
  initConfigFile: (filePath: string) => Promise<void>;
  tryResolveRepoRoot: (cwd: string) => Promise<string | null>;
  globalConfigPath: () => string;
  repoConfigPath: (repoRoot: string) => string;
  write: (message: string) => void;
  writeError: (message: string) => void;
  setExitCode: (code: number) => void;
}

async function tryResolveRepoRootDefault(cwd: string): Promise<string | null> {
  try {
    return await resolveRepoRoot(cwd);
  } catch {
    return null;
  }
}

const defaultDeps: ConfigCommandDeps = {
  loadConfigWithOrigins,
  setConfigKey: defaultSetConfigKey,
  initConfigFile: defaultInitConfigFile,
  tryResolveRepoRoot: tryResolveRepoRootDefault,
  globalConfigPath: defaultConfigPath,
  repoConfigPath: defaultRepoConfigPath,
  write: (msg) => process.stdout.write(msg),
  writeError: (msg) => process.stderr.write(msg),
  setExitCode: (code) => { process.exitCode = code; }
};

const VALID_KEYS = [
  'autonomous_mode',
  'watcher.interval_seconds',
  'watcher.source',
  'watcher.intake_mode',
  'watcher.initial_state',
  'watcher.trigger_label'
] as const;

type ConfigKey = typeof VALID_KEYS[number];

function isValidKey(key: string): key is ConfigKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

function validateValue(key: ConfigKey, value: string): string | null {
  if (key === 'autonomous_mode') {
    if (value !== 'true' && value !== 'false') {
      return `invalid value "${value}" for autonomous_mode — must be "true" or "false"`;
    }
  } else if (key === 'watcher.interval_seconds') {
    const n = Number.parseInt(value, 10);
    if (!/^\d+$/.test(value.trim()) || !Number.isFinite(n) || n < 5) {
      return `invalid value "${value}" for watcher.interval_seconds — must be an integer >= 5`;
    }
  } else if (key === 'watcher.source') {
    if (!isWatcherSource(value)) {
      return `invalid value "${value}" for watcher.source — must be "assigned-to-me" or "label"`;
    }
  } else if (key === 'watcher.intake_mode') {
    if (!isWatcherIntakeMode(value)) {
      return `invalid value "${value}" for watcher.intake_mode — must be "confirm" or "auto"`;
    }
  } else if (key === 'watcher.initial_state') {
    if (!isNonTerminalWorkflowState(value)) {
      return `invalid value "${value}" for watcher.initial_state — must be a non-terminal workflow state`;
    }
  } else if (key === 'watcher.trigger_label') {
    if (!value.trim()) {
      return `invalid value for watcher.trigger_label — must be non-empty`;
    }
  }
  return null;
}

function getConfigValue(key: ConfigKey, config: ConfigWithOrigins['config']): string {
  if (key === 'autonomous_mode') return String(config.autonomous_mode);
  if (key === 'watcher.interval_seconds') return String(config.watcher.interval_seconds);
  if (key === 'watcher.source') return config.watcher.source;
  if (key === 'watcher.intake_mode') return config.watcher.intake_mode;
  if (key === 'watcher.initial_state') return config.watcher.initial_state;
  return config.watcher.trigger_label;
}

export function registerConfigCommands(
  program: Command,
  deps: ConfigCommandDeps = defaultDeps
): Command {
  const config = program
    .command('config')
    .description('Read and write issueflow configuration');

  config
    .command('get <key>')
    .description(`Read the resolved value for a key (${VALID_KEYS.join(', ')})`)
    .action(async (key: string) => {
      if (!isValidKey(key)) {
        deps.writeError(`unknown key "${key}" — valid keys: ${VALID_KEYS.join(', ')}\n`);
        deps.setExitCode(1);
        return;
      }
      const repoRoot = await deps.tryResolveRepoRoot(process.cwd()) ?? undefined;
      const result = await deps.loadConfigWithOrigins(deps.globalConfigPath(), repoRoot);
      deps.write(`${getConfigValue(key, result.config)}\n`);
    });

  config
    .command('set <key> <value>')
    .description('Set a config value (default: global config; use --repo for repo config)')
    .option('--repo', 'Write to the repo config (.issueflow/config.yaml)')
    .action(async (key: string, value: string, options: { repo?: boolean }) => {
      if (!isValidKey(key)) {
        deps.writeError(`unknown key "${key}" — valid keys: ${VALID_KEYS.join(', ')}\n`);
        deps.setExitCode(1);
        return;
      }
      const validationError = validateValue(key, value);
      if (validationError) {
        deps.writeError(`${validationError}\n`);
        deps.setExitCode(1);
        return;
      }
      let targetPath: string;
      if (options.repo) {
        const repoRoot = await deps.tryResolveRepoRoot(process.cwd());
        if (!repoRoot) {
          deps.writeError('not inside a git repo — cannot use --repo\n');
          deps.setExitCode(1);
          return;
        }
        targetPath = deps.repoConfigPath(repoRoot);
      } else {
        targetPath = deps.globalConfigPath();
      }
      await deps.setConfigKey(targetPath, key, value);
      deps.write(`set ${key} = ${value} in ${targetPath}\n`);
    });

  config
    .command('show')
    .description('Print all resolved config values with their origin (default, global, repo)')
    .action(async () => {
      const repoRoot = await deps.tryResolveRepoRoot(process.cwd()) ?? undefined;
      const result = await deps.loadConfigWithOrigins(deps.globalConfigPath(), repoRoot);

      const rows: Array<[string, string, string]> = [
        ['autonomous_mode', String(result.config.autonomous_mode), result.origins.autonomous_mode],
        ['watcher.interval_seconds', String(result.config.watcher.interval_seconds), result.origins['watcher.interval_seconds']],
        ['watcher.source', result.config.watcher.source, result.origins['watcher.source']],
        ['watcher.intake_mode', result.config.watcher.intake_mode, result.origins['watcher.intake_mode']],
        ['watcher.initial_state', result.config.watcher.initial_state, result.origins['watcher.initial_state']],
        ['watcher.trigger_label', result.config.watcher.trigger_label, result.origins['watcher.trigger_label']]
      ];

      const keyWidth = Math.max(...rows.map(([k]) => k.length));
      const valWidth = Math.max(...rows.map(([, v]) => v.length));

      for (const [key, val, orig] of rows) {
        deps.write(`${key.padEnd(keyWidth)}  ${val.padEnd(valWidth)}  [${orig}]\n`);
      }
    });

  config
    .command('init')
    .description('Create a config file with commented defaults (fails if file already exists)')
    .option('--repo', 'Create the repo config (.issueflow/config.yaml) instead of the global config')
    .action(async (options: { repo?: boolean }) => {
      let targetPath: string;
      if (options.repo) {
        const repoRoot = await deps.tryResolveRepoRoot(process.cwd());
        if (!repoRoot) {
          deps.writeError('not inside a git repo — cannot use --repo\n');
          deps.setExitCode(1);
          return;
        }
        targetPath = deps.repoConfigPath(repoRoot);
      } else {
        targetPath = deps.globalConfigPath();
      }
      try {
        await deps.initConfigFile(targetPath);
        deps.write(`Created ${targetPath}\n`);
      } catch (error) {
        deps.writeError(`${error instanceof Error ? error.message : String(error)}\n`);
        deps.setExitCode(1);
      }
    });

  return config;
}
