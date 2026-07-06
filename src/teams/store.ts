import fs from 'node:fs/promises';
import path from 'node:path';

import { getFreesoloPath } from '../core/session-state.js';
import type { TeamRuntimeSnapshot } from './types.js';

export async function getTeamRuntimePath(worktreePath: string): Promise<string> {
  const rawPath = await getFreesoloPath(worktreePath, 'team-runtime.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

export async function writeTeamRuntimeSnapshot(
  worktreePath: string,
  snapshot: TeamRuntimeSnapshot
): Promise<void> {
  const runtimePath = await getTeamRuntimePath(worktreePath);
  await fs.mkdir(path.dirname(runtimePath), { recursive: true });
  await fs.writeFile(runtimePath, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export async function readTeamRuntimeSnapshot(
  worktreePath: string
): Promise<TeamRuntimeSnapshot | null> {
  const runtimePath = await getTeamRuntimePath(worktreePath);
  try {
    const contents = await fs.readFile(runtimePath, 'utf8');
    return JSON.parse(contents) as TeamRuntimeSnapshot;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
