import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getTeamPlanPath,
  readTeamPlan,
  TeamPlanNotFoundError,
  writeTeamPlan
} from '../../src/planner/store.js';
import type { TeamDefinition } from '../../src/planner/types.js';

const definition: TeamDefinition = {
  roles: [{ name: 'Engineer', host: 'cursor', responsibility: 'Ship feature', count: 1 }]
};

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-plan-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('team plan store', () => {
  it('writes and reads a team plan round-trip', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    expect(await readTeamPlan(worktreePath)).toEqual(definition);
  });

  it('throws TeamPlanNotFoundError when file is missing', async () => {
    const worktreePath = await makeWorktree();
    await expect(readTeamPlan(worktreePath)).rejects.toBeInstanceOf(TeamPlanNotFoundError);
  });

  it('getTeamPlanPath resolves under git issueflow dir', async () => {
    const worktreePath = await makeWorktree();
    const teamPlanPath = await getTeamPlanPath(worktreePath);
    expect(teamPlanPath).toContain('issueflow');
    expect(teamPlanPath.endsWith('team-plan.json')).toBe(true);
  });
});
