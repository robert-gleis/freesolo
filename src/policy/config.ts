import fs from 'node:fs/promises';
import path from 'node:path';

import { defaultConfigPath, loadConfig, parseAutonomousModeFromContent } from '../config/load.js';

export interface ResolveAutonomousModeDeps {
  globalConfigPath?: string;
  readFile?: typeof fs.readFile;
}

async function readRepoAutonomousMode(
  repoRoot: string,
  readFile: typeof fs.readFile
): Promise<boolean | undefined> {
  const repoConfigPath = path.join(repoRoot, '.issueflow', 'config.yaml');
  try {
    const content = await readFile(repoConfigPath, 'utf8');
    return parseAutonomousModeFromContent(content, repoConfigPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export async function resolveAutonomousMode(
  repoRoot: string,
  deps: ResolveAutonomousModeDeps = {}
): Promise<boolean> {
  const readFile = deps.readFile ?? fs.readFile;
  const repoMode = await readRepoAutonomousMode(repoRoot, readFile);
  if (repoMode !== undefined) {
    return repoMode;
  }
  const config = await loadConfig(deps.globalConfigPath ?? defaultConfigPath());
  return config.autonomous_mode;
}
