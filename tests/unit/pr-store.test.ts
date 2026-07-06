import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getPullRequestPath,
  readPullRequestRecord,
  writePullRequestRecord
} from '../../src/integration/pr-store.js';
import { PullRequestError } from '../../src/integration/pr-types.js';
import type { PullRequestRecord } from '../../src/integration/pr-types.js';

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-pr-store-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

const sampleRecord: PullRequestRecord = {
  issueNumber: 43,
  issueSlug: 'automated-pull-request-creation',
  prNumber: 99,
  prUrl: 'https://github.com/example/repo/pull/99',
  title: 'Issue #43: Automated Pull Request Creation',
  headBranch: 'candidate/43-automated-pull-request-creation',
  baseBranch: 'main',
  verificationRunId: '20260608-120000',
  implementationReviewPath: '/repo/docs/freesolo/reviews/review.md',
  specPath: '/repo/docs/freesolo/specs/spec.md',
  createdAt: '2026-06-08T00:00:00.000Z'
};

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('pull request store', () => {
  it('round-trips a record via getPullRequestPath', async () => {
    const worktreePath = await makeWorktree();
    await writePullRequestRecord(worktreePath, sampleRecord);
    const recordPath = await getPullRequestPath(worktreePath);
    expect(path.isAbsolute(recordPath)).toBe(true);
    const loaded = await readPullRequestRecord(worktreePath);
    expect(loaded).toEqual(sampleRecord);
  });

  it('returns null when no record exists', async () => {
    const worktreePath = await makeWorktree();
    await expect(readPullRequestRecord(worktreePath)).resolves.toBeNull();
  });

  it('throws invalid-record for malformed JSON', async () => {
    const worktreePath = await makeWorktree();
    const recordPath = await getPullRequestPath(worktreePath);
    await fs.mkdir(path.dirname(recordPath), { recursive: true });
    await fs.writeFile(recordPath, '{ not json');

    await expect(readPullRequestRecord(worktreePath)).rejects.toMatchObject({
      code: 'invalid-record'
    });
  });
});
