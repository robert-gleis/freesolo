import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearCandidateBranchRecord,
  getCandidateBranchPath,
  readCandidateBranchRecord,
  writeCandidateBranchRecord
} from '../../src/integration/store.js';
import { CandidateBranchError } from '../../src/integration/types.js';
import type { CandidateBranchRecord } from '../../src/integration/types.js';

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-candidate-store-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

const sampleRecord: CandidateBranchRecord = {
  branchName: 'candidate/35-candidate-branch-creation',
  issueNumber: 35,
  issueSlug: 'candidate-branch-creation',
  teamId: 'team-1',
  sources: [{ branchName: 'issue/35-a', ownerKind: 'team', ownerId: 'team-1' }],
  baseBranch: 'main',
  mergeCommitSha: 'abc123',
  status: 'ready',
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z'
};

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('candidate branch store', () => {
  it('round-trips a record via getCandidateBranchPath', async () => {
    const worktreePath = await makeWorktree();
    await writeCandidateBranchRecord(worktreePath, sampleRecord);
    const recordPath = await getCandidateBranchPath(worktreePath);
    expect(path.isAbsolute(recordPath)).toBe(true);
    const loaded = await readCandidateBranchRecord(worktreePath);
    expect(loaded).toEqual(sampleRecord);
  });

  it('returns null when no record exists', async () => {
    const worktreePath = await makeWorktree();
    await expect(readCandidateBranchRecord(worktreePath)).resolves.toBeNull();
  });

  it('throws invalid-record for malformed JSON', async () => {
    const worktreePath = await makeWorktree();
    const recordPath = await getCandidateBranchPath(worktreePath);
    await fs.mkdir(path.dirname(recordPath), { recursive: true });
    await fs.writeFile(recordPath, '{ not json');

    await expect(readCandidateBranchRecord(worktreePath)).rejects.toMatchObject({
      code: 'invalid-record'
    });
  });

  it('clears an existing record', async () => {
    const worktreePath = await makeWorktree();
    await writeCandidateBranchRecord(worktreePath, sampleRecord);
    await clearCandidateBranchRecord(worktreePath);
    await expect(readCandidateBranchRecord(worktreePath)).resolves.toBeNull();
  });
});
