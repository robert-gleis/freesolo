import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_CONFIG,
  MIN_INTERVAL_SECONDS,
  type IssueflowConfig,
  type WatcherConfig
} from './types.js';

export function defaultConfigPath(): string {
  return process.env.ISSUEFLOW_CONFIG ?? path.join(os.homedir(), '.issueflow', 'config.yaml');
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

function validateWatcher(configPath: string, watcher: WatcherConfig): void {
  if (!Number.isFinite(watcher.interval_seconds) || watcher.interval_seconds < MIN_INTERVAL_SECONDS) {
    throw new Error(`${configPath}: watcher.interval_seconds must be >= ${MIN_INTERVAL_SECONDS}`);
  }
  if (!watcher.trigger_label.trim()) {
    throw new Error(`${configPath}: watcher.trigger_label must be non-empty`);
  }
}

export async function loadConfig(configPath = defaultConfigPath()): Promise<IssueflowConfig> {
  let content: string;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(DEFAULT_CONFIG);
    }
    throw error;
  }

  const watcherPartial = parseWatcherBlock(content.split('\n'));
  const watcher: WatcherConfig = {
    ...DEFAULT_CONFIG.watcher,
    ...watcherPartial
  };
  validateWatcher(configPath, watcher);
  return { watcher };
}
