import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import {
  createDefaultDecompositionAgent,
  runIssueDecomposer
} from '../../src/planner/decomposition-runner.js';
import { readDecomposition } from '../../src/planner/decomposition-store.js';
import { PlannerError } from '../../src/planner/errors.js';

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-decomp-run-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('runIssueDecomposer', () => {
  it('writes decomposition preview with matching parent_issue', async () => {
    const worktreePath = await makeWorktree();
    const issue = { number: 37, title: 'Epic', body: 'Big issue' };
    const agent = createDefaultDecompositionAgent(issue);
    const result = await runIssueDecomposer({ worktreePath, issue, agent });
    expect(result.plan.parent_issue).toBe(37);
    expect(result.plan.children.length).toBeGreaterThanOrEqual(1);
    expect(await readDecomposition(worktreePath)).toEqual(result.plan);
    expect(result.decompositionPath).toContain('decomposition.json');
  });

  it('rejects planner output with mismatched parent_issue', async () => {
    const worktreePath = await makeWorktree();
    const badJson = JSON.stringify({
      parent_issue: 99,
      children: [{ title: 'X', body: 'y', labels: [] }]
    });
    const agent = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: badJson }] });
    await expect(
      runIssueDecomposer({
        worktreePath,
        issue: { number: 37, title: 'Epic', body: 'body' },
        agent
      })
    ).rejects.toThrow(PlannerError);
  });
});
