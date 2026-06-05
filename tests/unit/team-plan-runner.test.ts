import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import { PlannerError } from '../../src/planner/errors.js';
import { createDefaultPlannerAgent, runTeamPlanner } from '../../src/planner/team-plan.js';

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-team-plan-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const issue = { number: 34, title: 'Team Planner', body: 'Build it' };

describe('runTeamPlanner', () => {
  it('writes a validated team plan using the default scripted agent', async () => {
    const worktreePath = await makeWorktree();
    const agent = createDefaultPlannerAgent(issue);

    const result = await runTeamPlanner({ worktreePath, issue, agent });

    expect(result.definition.roles.length).toBeGreaterThan(0);
    expect(result.teamPlanPath).toContain('team-plan.json');
    const onDisk = JSON.parse(await fs.readFile(result.teamPlanPath, 'utf8'));
    expect(onDisk).toEqual(result.definition);
  });

  it('throws PlannerError when agent returns invalid JSON', async () => {
    const worktreePath = await makeWorktree();
    const agent = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'not json' }]
    });

    await expect(runTeamPlanner({ worktreePath, issue, agent })).rejects.toBeInstanceOf(PlannerError);
  });

  it('throws PlannerError when agent returns JSON that fails validation', async () => {
    const worktreePath = await makeWorktree();
    const agent = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify({ roles: [] }) }]
    });

    await expect(runTeamPlanner({ worktreePath, issue, agent })).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'invalid-output'
    });
  });
});
