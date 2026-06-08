import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CONFIG,
  MIN_INTERVAL_SECONDS,
  type IssueflowConfig,
  type StateBackend,
  type WatcherConfig
} from './types.js';

export type ConfigOrigin = 'default' | 'global' | 'repo';

export interface ConfigWithOrigins {
  config: IssueflowConfig;
  origins: {
    state_backend: ConfigOrigin;
    autonomous_mode: ConfigOrigin;
    'watcher.interval_seconds': ConfigOrigin;
    'watcher.trigger_label': ConfigOrigin;
  };
}

export interface RawConfig {
  state_backend?: StateBackend;
  autonomous_mode?: boolean;
  watcher?: Partial<WatcherConfig>;
}

export function defaultConfigPath(): string {
  return process.env.ISSUEFLOW_CONFIG ?? path.join(os.homedir(), '.issueflow', 'config.yaml');
}

export function repoConfigPath(repoRoot: string): string {
  return path.join(repoRoot, '.issueflow', 'config.yaml');
}

function parseWatcherBlock(lines: string[]): Partial<WatcherConfig> {
  const result: Partial<WatcherConfig> = {};
  let inWatcher = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'watcher:') {
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

export function parseStateBackendFromContent(
  content: string,
  configPath: string
): StateBackend | undefined {
  for (const raw of content.split('\n')) {
    const line = raw.trimEnd();
    const match = line.match(/^state_backend:\s*(.+)$/);
    if (!match) continue;
    const value = match[1].replace(/^["']|["']$/g, '').trim();
    if (value === 'github-labels' || value === 'local') return value;
    throw new Error(`${configPath}: state_backend must be "github-labels" or "local"`);
  }
  return undefined;
}

function validateWatcher(configPath: string, watcher: WatcherConfig): void {
  if (!Number.isFinite(watcher.interval_seconds) || watcher.interval_seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`${configPath}: watcher.interval_seconds must be >= ${MIN_INTERVAL_SECONDS}`);
  }
  if (!watcher.trigger_label.trim()) {
    throw new Error(`${configPath}: watcher.trigger_label must be non-empty`);
  }
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
    state_backend: parseStateBackendFromContent(content, configPath),
    autonomous_mode: parseAutonomousModeFromContent(content, configPath),
    watcher: Object.keys(watcherPartial).length > 0 ? watcherPartial : undefined
  };
}

export async function loadConfig(
  globalPath = defaultConfigPath(),
  repoRoot?: string
): Promise<IssueflowConfig> {
  const globalContent = await readFileOrNull(globalPath);
  const globalRaw = globalContent ? parseRawConfig(globalContent, globalPath) : {};

  let repoRaw: RawConfig = {};
  if (repoRoot) {
    const repoPath = repoConfigPath(repoRoot);
    const repoContent = await readFileOrNull(repoPath);
    if (repoContent) repoRaw = parseRawConfig(repoContent, repoPath);
  }

  const watcher: WatcherConfig = {
    ...DEFAULT_CONFIG.watcher,
    ...globalRaw.watcher,
    ...repoRaw.watcher
  };
  const configPath = repoRoot ? repoConfigPath(repoRoot) : globalPath;
  validateWatcher(configPath, watcher);

  return {
    watcher,
    autonomous_mode: repoRaw.autonomous_mode ?? globalRaw.autonomous_mode ?? DEFAULT_CONFIG.autonomous_mode,
    state_backend: repoRaw.state_backend ?? globalRaw.state_backend ?? DEFAULT_CONFIG.state_backend
  };
}

export async function loadConfigWithOrigins(
  globalPath = defaultConfigPath(),
  repoRoot?: string
): Promise<ConfigWithOrigins> {
  const globalContent = await readFileOrNull(globalPath);
  const globalRaw = globalContent ? parseRawConfig(globalContent, globalPath) : {};

  let repoRaw: RawConfig = {};
  if (repoRoot) {
    const repoPath = repoConfigPath(repoRoot);
    const repoContent = await readFileOrNull(repoPath);
    if (repoContent) repoRaw = parseRawConfig(repoContent, repoPath);
  }

  const watcher: WatcherConfig = {
    ...DEFAULT_CONFIG.watcher,
    ...globalRaw.watcher,
    ...repoRaw.watcher
  };
  const configPath = repoRoot ? repoConfigPath(repoRoot) : globalPath;
  validateWatcher(configPath, watcher);

  const config: IssueflowConfig = {
    watcher,
    autonomous_mode: repoRaw.autonomous_mode ?? globalRaw.autonomous_mode ?? DEFAULT_CONFIG.autonomous_mode,
    state_backend: repoRaw.state_backend ?? globalRaw.state_backend ?? DEFAULT_CONFIG.state_backend
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
      state_backend: origin(repoRaw.state_backend, globalRaw.state_backend),
      autonomous_mode: origin(repoRaw.autonomous_mode, globalRaw.autonomous_mode),
      'watcher.interval_seconds': origin(repoRaw.watcher?.interval_seconds, globalRaw.watcher?.interval_seconds),
      'watcher.trigger_label': origin(repoRaw.watcher?.trigger_label, globalRaw.watcher?.trigger_label)
    }
  };
}
