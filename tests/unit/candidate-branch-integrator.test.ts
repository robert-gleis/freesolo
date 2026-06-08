import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { createCandidateBranch, type GitCommandRunner } from '../../src/integration/integrator.js';
import { readCandidateBranchRecord } from '../../src/integration/store.js';
import { CandidateBranchError } from '../../src/integration/types.js';
import type { CreateCandidateBranchInput } from '../../src/integration/types.js';

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-candidate-int-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function baseInput(repoRoot: string): CreateCandidateBranchInput {
  return {
    repoRoot,
    issueNumber: 35,
    issueSlug: 'candidate-branch-creation',
    teamId: 'team-1',
    sources: [
      { branchName: 'issue/35-a', ownerKind: 'team', ownerId: 'team-1' },
      { branchName: 'issue/35-b', ownerKind: 'team', ownerId: 'team-1' }
    ]
  };
}

function createFakeGit(
  handlers: Record<string, (args: string[]) => { stdout?: string; stderr?: string; exitCode?: number }>
): { runGit: GitCommandRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runGit: GitCommandRunner = async (args) => {
    calls.push(args);
    const key = args.join(' ');
    const handler = handlers[key];
    if (handler) {
      return {
        stdout: handler(args).stdout ?? '',
        stderr: handler(args).stderr ?? '',
        exitCode: handler(args).exitCode ?? 0
      };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  };
  return { runGit, calls };
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('createCandidateBranch', () => {
  it('throws no-sources before touching git', async () => {
    const repoRoot = await makeWorktree();
    const { runGit, calls } = createFakeGit({});
    await expect(
      createCandidateBranch({ ...baseInput(repoRoot), sources: [] }, { runGit, now: () => new Date('2026-06-08T00:00:00.000Z') })
    ).rejects.toMatchObject({ code: 'no-sources' });
    expect(calls).toEqual([]);
  });

  it('throws branch-not-found when rev-parse fails', async () => {
    const repoRoot = await makeWorktree();
    const { runGit } = createFakeGit({
      'rev-parse --verify refs/heads/issue/35-a': () => ({ exitCode: 1, stderr: 'fatal: not found' })
    });

    await expect(
      createCandidateBranch(baseInput(repoRoot), { runGit, now: () => new Date('2026-06-08T00:00:00.000Z') })
    ).rejects.toMatchObject({ code: 'branch-not-found' });
  });

  it('creates a candidate branch when merges succeed', async () => {
    const repoRoot = await makeWorktree();
    const { runGit } = createFakeGit({
      'rev-parse --verify refs/heads/issue/35-a': () => ({}),
      'rev-parse --verify refs/heads/issue/35-b': () => ({}),
      'checkout -B candidate/35-candidate-branch-creation main': () => ({}),
      'merge --no-commit --no-ff issue/35-a': () => ({}),
      'merge --no-commit --no-ff issue/35-b': () => ({}),
      'diff --name-only --diff-filter=U': () => ({ stdout: '' }),
      'commit -m candidate: integrate team team-1 for issue #35': () => ({}),
      'rev-parse HEAD': () => ({ stdout: 'deadbeef\n' })
    });

    const outcome = await createCandidateBranch(baseInput(repoRoot), {
      runGit,
      now: () => new Date('2026-06-08T00:00:00.000Z')
    });

    expect(outcome.status).toBe('created');
    if (outcome.status === 'created') {
      expect(outcome.branchName).toBe('candidate/35-candidate-branch-creation');
      expect(outcome.mergeCommitSha).toBe('deadbeef');
      expect(outcome.record.status).toBe('ready');
    }

    const stored = await readCandidateBranchRecord(repoRoot);
    expect(stored?.status).toBe('ready');
    expect(stored?.mergeCommitSha).toBe('deadbeef');
  });

  it('returns conflict with abort and provenance when merge fails', async () => {
    const repoRoot = await makeWorktree();
    let diffCalls = 0;
    const { runGit, calls } = createFakeGit({
      'rev-parse --verify refs/heads/issue/35-a': () => ({}),
      'rev-parse --verify refs/heads/issue/35-b': () => ({}),
      'checkout -B candidate/35-candidate-branch-creation main': () => ({}),
      'merge --no-commit --no-ff issue/35-a': () => ({}),
      'merge --no-commit --no-ff issue/35-b': () => ({
        exitCode: 1,
        stderr: 'CONFLICT (content): Merge conflict in file.txt'
      }),
      'diff --name-only --diff-filter=U': () => {
        diffCalls += 1;
        return diffCalls === 1 ? { stdout: '' } : { stdout: 'file.txt\n' };
      },
      'merge --abort': () => ({}),
    });

    const outcome = await createCandidateBranch(baseInput(repoRoot), {
      runGit,
      now: () => new Date('2026-06-08T00:00:00.000Z')
    });

    expect(outcome.status).toBe('conflict');
    if (outcome.status === 'conflict') {
      expect(outcome.conflictingBranch).toBe('issue/35-b');
      expect(outcome.conflictedFiles).toEqual(['file.txt']);
      expect(outcome.gitOutput).toContain('CONFLICT');
      expect(outcome.record.status).toBe('conflict');
      expect(outcome.record.mergeCommitSha).toBeNull();
    }

    const abortIndex = calls.findIndex((args) => args[0] === 'merge' && args[1] === '--abort');
    expect(abortIndex).toBeGreaterThan(-1);

    const resetIndex = calls.findIndex(
      (args, index) =>
        index > abortIndex &&
        args[0] === 'checkout' &&
        args[1] === '-B' &&
        args[2] === 'candidate/35-candidate-branch-creation'
    );
    expect(resetIndex).toBeGreaterThan(abortIndex);
  });

  it('returns already-exists for a ready record without further git calls', async () => {
    const repoRoot = await makeWorktree();
    const readyRecord = {
      branchName: 'candidate/35-candidate-branch-creation',
      issueNumber: 35,
      issueSlug: 'candidate-branch-creation',
      teamId: 'team-1',
      sources: [{ branchName: 'issue/35-a', ownerKind: 'team' as const, ownerId: 'team-1' }],
      baseBranch: 'main',
      mergeCommitSha: 'abc',
      status: 'ready' as const,
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:00.000Z'
    };
    const { writeCandidateBranchRecord } = await import('../../src/integration/store.js');
    await writeCandidateBranchRecord(repoRoot, readyRecord);

    const { runGit, calls } = createFakeGit({});
    const outcome = await createCandidateBranch(baseInput(repoRoot), { runGit });

    expect(outcome.status).toBe('already-exists');
    expect(calls).toEqual([]);
  });

  it('force clears provenance and recreates the candidate branch', async () => {
    const repoRoot = await makeWorktree();
    const { writeCandidateBranchRecord } = await import('../../src/integration/store.js');
    await writeCandidateBranchRecord(repoRoot, {
      branchName: 'candidate/35-candidate-branch-creation',
      issueNumber: 35,
      issueSlug: 'candidate-branch-creation',
      teamId: 'team-1',
      sources: [{ branchName: 'issue/35-a', ownerKind: 'team', ownerId: 'team-1' }],
      baseBranch: 'main',
      mergeCommitSha: 'oldsha',
      status: 'ready',
      createdAt: '2026-06-08T00:00:00.000Z',
      updatedAt: '2026-06-08T00:00:00.000Z'
    });

    const { runGit, calls } = createFakeGit({
      'branch -D candidate/35-candidate-branch-creation': () => ({}),
      'rev-parse --verify refs/heads/issue/35-a': () => ({}),
      'rev-parse --verify refs/heads/issue/35-b': () => ({}),
      'checkout -B candidate/35-candidate-branch-creation main': () => ({}),
      'merge --no-commit --no-ff issue/35-a': () => ({}),
      'merge --no-commit --no-ff issue/35-b': () => ({}),
      'diff --name-only --diff-filter=U': () => ({ stdout: '' }),
      'commit -m candidate: integrate team team-1 for issue #35': () => ({}),
      'rev-parse HEAD': () => ({ stdout: 'newsha\n' })
    });

    const outcome = await createCandidateBranch({ ...baseInput(repoRoot), force: true }, { runGit });
    expect(outcome.status).toBe('created');
    expect(calls[0]).toEqual(['branch', '-D', 'candidate/35-candidate-branch-creation']);

    const stored = await readCandidateBranchRecord(repoRoot);
    expect(stored?.mergeCommitSha).toBe('newsha');
  });

  it('throws git-error when checkout fails', async () => {
    const repoRoot = await makeWorktree();
    const { runGit } = createFakeGit({
      'rev-parse --verify refs/heads/issue/35-a': () => ({}),
      'rev-parse --verify refs/heads/issue/35-b': () => ({}),
      'checkout -B candidate/35-candidate-branch-creation main': () => ({
        exitCode: 128,
        stderr: 'fatal: reference is not a tree'
      })
    });

    await expect(createCandidateBranch(baseInput(repoRoot), { runGit })).rejects.toBeInstanceOf(
      CandidateBranchError
    );
    await expect(createCandidateBranch(baseInput(repoRoot), { runGit })).rejects.toMatchObject({
      code: 'git-error'
    });
  });
});
