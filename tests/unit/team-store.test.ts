import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import {
  getTeamRuntimePath,
  readTeamRuntimeSnapshot,
  writeTeamRuntimeSnapshot
} from '../../src/teams/store.js';

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-team-store-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

describe('team runtime store', () => {
  it('round-trips snapshot via git freesolo path', async () => {
    const worktreePath = await makeRepo();
    const snapshot = { issueNumber: 41, phase: 'running' as const, members: [] };
    await writeTeamRuntimeSnapshot(worktreePath, snapshot);
    const runtimePath = await getTeamRuntimePath(worktreePath);
    expect(await readTeamRuntimeSnapshot(worktreePath)).toEqual(snapshot);
    expect(runtimePath).toContain('team-runtime.json');
  });
});
