import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_CONFIG,
  MIN_INTERVAL_SECONDS,
  isWatcherIntakeMode,
  isWatcherSource,
  type IssueflowConfig,
  type WatcherConfig
} from './types.js';
import { issueflowHome } from '../core/paths.js';
import { isNonTerminalWorkflowState } from '../workflow/state-machine.js';

export type ConfigOrigin = 'default' | 'global' | 'repo';

export interface ConfigWithOrigins {
  config: IssueflowConfig;
  origins: {
    autonomous_mode: ConfigOrigin;
    'watcher.interval_seconds': ConfigOrigin;
    'watcher.source': ConfigOrigin;
    'watcher.intake_mode': ConfigOrigin;
    'watcher.initial_state': ConfigOrigin;
    'watcher.trigger_label': ConfigOrigin;
  };
}

export interface RawConfig {
  autonomous_mode?: boolean;
  watcher?: Partial<RawWatcherConfig>;
}

interface RawWatcherConfig {
  interval_seconds: number;
  source: string;
  intake_mode: string;
  initial_state: string;
  trigger_label: string;
}

export function defaultConfigPath(): string {
  return process.env.ISSUEFLOW_CONFIG ?? path.join(issueflowHome(), 'config.yaml');
}

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, '.issueflow', 'config.yaml');
}

function parseWatcherBlock(lines: string[]): Partial<RawWatcherConfig> {
  const result: Partial<RawWatcherConfig> = {};
  let inWatcher = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^watcher:\s*(#.*)?$/.test(line)) {
      inWatcher = true;
      continue;
    }
    if (inWatcher && /^[A-Za-z]/.test(line) && !line.startsWith(' ')) {
      break;
    }
    if (!inWatcher) continue;

    const match = line.match(/^\s+(\w+):\s*(.+)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["']|["']$/g, '').trim();

    if (key === 'interval_seconds') {
      result.interval_seconds = Number.parseInt(value, 10);
    } else if (key === 'source') {
      result.source = value;
    } else if (key === 'intake_mode') {
      result.intake_mode = value;
    } else if (key === 'initial_state') {
      result.initial_state = value;
    } else if (key === 'trigger_label') {
      result.trigger_label = value;
    }
  }

  return result;
}

export function parseAutonomousModeFromContent(
  content: string,
  configPath: string
): boolean | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    const match = line.match(/^autonomous_mode:\s*(.+)$/);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, '').trim();
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`${configPath}: autonomous_mode must be true or false`);
  }
  return undefined;
}

function validateWatcher(configPath: string, watcher: RawWatcherConfig): WatcherConfig {
  if (!Number.isFinite(watcher.interval_seconds) || watcher.interval_seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`${configPath}: watcher.interval_seconds must be >= ${MIN_INTERVAL_SECONDS}`);
  }
  if (!isWatcherSource(watcher.source)) {
    throw new Error(`${configPath}: watcher.source must be "assigned-to-me" or "label"`);
  }
  if (!isWatcherIntakeMode(watcher.intake_mode)) {
    throw new Error(`${configPath}: watcher.intake_mode must be "confirm" or "auto"`);
  }
  if (!isNonTerminalWorkflowState(watcher.initial_state)) {
    throw new Error(`${configPath}: watcher.initial_state must be a non-terminal workflow state`);
  }
  if (!watcher.trigger_label.trim()) {
    throw new Error(`${configPath}: watcher.trigger_label must be non-empty`);
  }
  return {
    interval_seconds: watcher.interval_seconds,
    source: watcher.source,
    intake_mode: watcher.intake_mode,
    initial_state: watcher.initial_state,
    trigger_label: watcher.trigger_label
  };
}

function buildWatcher(
  globalRaw: RawConfig,
  repoRaw: RawConfig,
  globalPath: string,
  repoRoot: string | undefined
): WatcherConfig {
  const watcher: RawWatcherConfig = {
    ...DEFAULT_CONFIG.watcher,
    ...globalRaw.watcher,
    ...repoRaw.watcher
  };
  const configPath = repoRaw.watcher !== undefined && repoRoot
    ? repoConfigPath(repoRoot)
    : globalPath;
  return validateWatcher(configPath, watcher);
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function parseRawConfig(content: string, configPath: string): RawConfig {
  const lines = content.split('\n');
  const watcherPartial = parseWatcherBlock(lines);
  return {
    autonomous_mode: parseAutonomousModeFromContent(content, configPath),
    watcher: Object.keys(watcherPartial).length > 0 ? watcherPartial : undefined
  };
}

interface RawLayers {
  globalRaw: RawConfig;
  repoRaw: RawConfig;
}

async function loadRawLayers(
  globalPath: string,
  repoRoot?: string
): Promise<RawLayers> {
  const globalContent = await readFileOrNull(globalPath);
  const globalRaw = globalContent ? parseRawConfig(globalContent, globalPath) : {};

  let repoRaw: RawConfig = {};
  if (repoRoot) {
    const repoPath = repoConfigPath(repoRoot);
    const repoContent = await readFileOrNull(repoPath);
    if (repoContent) repoRaw = parseRawConfig(repoContent, repoPath);
  }

  return { globalRaw, repoRaw };
}

export async function loadConfig(
  globalPath = defaultConfigPath(),
  repoRoot?: string
): Promise<IssueflowConfig> {
  return (await loadConfigWithOrigins(globalPath, repoRoot)).config;
}

export async function loadConfigWithOrigins(
  globalPath = defaultConfigPath(),
  repoRoot?: string
): Promise<ConfigWithOrigins> {
  const { globalRaw, repoRaw } = await loadRawLayers(globalPath, repoRoot);

  const watcher = buildWatcher(globalRaw, repoRaw, globalPath, repoRoot);

  const config: IssueflowConfig = {
    watcher,
    autonomous_mode: repoRaw.autonomous_mode ?? globalRaw.autonomous_mode ?? DEFAULT_CONFIG.autonomous_mode
  };

  function origin<T>(
    repoVal: T | undefined,
    globalVal: T | undefined
  ): ConfigOrigin {
    if (repoVal !== undefined) return 'repo';
    if (globalVal !== undefined) return 'global';
    return 'default';
  }

  return {
    config,
    origins: {
      autonomous_mode: origin(repoRaw.autonomous_mode, globalRaw.autonomous_mode),
      'watcher.interval_seconds': origin(repoRaw.watcher?.interval_seconds, globalRaw.watcher?.interval_seconds),
      'watcher.source': origin(repoRaw.watcher?.source, globalRaw.watcher?.source),
      'watcher.intake_mode': origin(repoRaw.watcher?.intake_mode, globalRaw.watcher?.intake_mode),
      'watcher.initial_state': origin(repoRaw.watcher?.initial_state, globalRaw.watcher?.initial_state),
      'watcher.trigger_label': origin(repoRaw.watcher?.trigger_label, globalRaw.watcher?.trigger_label)
    }
  };
}
