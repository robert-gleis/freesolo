import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertParentIssueMatches,
  DecompositionNotFoundError,
  DecompositionValidationError,
  getDecompositionAppliedPath,
  getDecompositionPath,
  readDecomposition,
  readDecompositionApplied,
  validateDecompositionFile,
  writeDecomposition,
  writeDecompositionApplied
} from '../../src/planner/decomposition-store.js';
import type { DecompositionPlan } from '../../src/planner/schemas/decomposition-plan.js';

const plan: DecompositionPlan = {
  parent_issue: 37,
  children: [
    { title: 'Backend', body: '## Parent\n\n#37\n\nAPI work', labels: ['state:triaged'] }
  ]
};

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-decomp-store-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('decomposition store', () => {
  it('writes and reads decomposition.json', async () => {
    const worktreePath = await makeWorktree();
    const decompositionPath = await writeDecomposition(worktreePath, plan);
    expect(decompositionPath).toBe(await getDecompositionPath(worktreePath));
    expect(await readDecomposition(worktreePath)).toEqual(plan);
  });

  it('throws DecompositionNotFoundError when missing', async () => {
    const worktreePath = await makeWorktree();
    await expect(readDecomposition(worktreePath)).rejects.toThrow(DecompositionNotFoundError);
  });

  it('validateDecompositionFile rejects invalid JSON', () => {
    expect(() => validateDecompositionFile('not json')).toThrow(DecompositionValidationError);
  });

  it('assertParentIssueMatches rejects mismatch', () => {
    expect(() => assertParentIssueMatches(plan, 99)).toThrow(DecompositionValidationError);
    expect(assertParentIssueMatches(plan, 37)).toEqual(plan);
  });

  it('readDecompositionApplied returns null when absent', async () => {
    const worktreePath = await makeWorktree();
    expect(await readDecompositionApplied(worktreePath)).toBeNull();
  });

  it('writes and reads applied record', async () => {
    const worktreePath = await makeWorktree();
    const record = {
      parent_issue: 37,
      applied_at: '2026-06-08T00:00:00.000Z',
      children: [{ number: 101, title: 'Backend', url: 'https://github.com/o/r/issues/101' }]
    };
    await writeDecompositionApplied(worktreePath, record);
    expect(await readDecompositionApplied(worktreePath)).toEqual(record);
    expect(await getDecompositionAppliedPath(worktreePath)).toContain('decomposition-applied.json');
  });
});
