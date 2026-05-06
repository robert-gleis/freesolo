import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import {
  buildBranchName,
  createIssueWorktree,
  ensureUniqueWorkspaceNames,
  findExistingWorkspaceMatch,
  runWorktreeSetup
} from '../../src/core/worktree.js';

describe('findExistingWorkspaceMatch', () => {
  it('prefers an existing worktree for the issue branch', () => {
    const match = findExistingWorkspaceMatch(
      ['issue/12-ship-issueflow-start'],
      [{ branchName: 'issue/12-ship-issueflow-start', worktreePath: '/tmp/issueflow-12-ship-issueflow-start' }],
      12
    );

    expect(match?.worktreePath).toBe('/tmp/issueflow-12-ship-issueflow-start');
  });
});

describe('buildBranchName', () => {
  it('uses the neutral issue prefix', () => {
    expect(buildBranchName({ number: 12, slug: 'ship-issueflow-start' })).toBe('issue/12-ship-issueflow-start');
  });
});

describe('ensureUniqueWorkspaceNames', () => {
  it('appends a numeric suffix when the default branch and path already exist', () => {
    expect(
      ensureUniqueWorkspaceNames(
        '/repo/issueflow',
        { number: 12, slug: 'ship-issueflow-start' },
        ['issue/12-ship-issueflow-start'],
        [{ branchName: 'issue/12-ship-issueflow-start', worktreePath: '/repo/issueflow-12-ship-issueflow-start' }]
      )
    ).toEqual({
      branchName: 'issue/12-ship-issueflow-start-2',
      worktreePath: '/repo/issueflow-12-ship-issueflow-start-2'
    });
  });
});

describe('createIssueWorktree', () => {
  it('creates the issue branch from origin/main instead of the current branch', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-git-'));
    const repoRoot = path.join(tempDir, 'repo');
    const worktreePath = path.join(tempDir, 'issue-worktree');

    try {
      await fs.mkdir(repoRoot);
      await execa('git', ['init', '--initial-branch=main'], { cwd: repoRoot });
      await execa('git', ['config', 'user.name', 'Issueflow Test'], { cwd: repoRoot });
      await execa('git', ['config', 'user.email', 'issueflow@example.test'], { cwd: repoRoot });
      await fs.writeFile(path.join(repoRoot, 'marker.txt'), 'main\n');
      await execa('git', ['add', 'marker.txt'], { cwd: repoRoot });
      await execa('git', ['commit', '-m', 'main state'], { cwd: repoRoot });
      await execa('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: repoRoot });

      await execa('git', ['checkout', '-b', 'feature'], { cwd: repoRoot });
      await fs.writeFile(path.join(repoRoot, 'marker.txt'), 'feature\n');
      await execa('git', ['commit', '-am', 'feature state'], { cwd: repoRoot });

      await createIssueWorktree(repoRoot, worktreePath, 'issue/12-ship-issueflow-start');

      await expect(fs.readFile(path.join(worktreePath, 'marker.txt'), 'utf8')).resolves.toBe('main\n');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('runWorktreeSetup', () => {
  it('returns false when the worktree does not define a setup hook', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-worktree-'));

    try {
      await expect(runWorktreeSetup('/repo', worktreePath)).resolves.toBe(false);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it('runs the setup hook from the worktree with the source checkout in MAIN_REPO_ROOT', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-worktree-'));
    const scriptsDir = path.join(worktreePath, 'scripts');
    const outputPath = path.join(worktreePath, 'setup-output.txt');

    try {
      await fs.mkdir(scriptsDir);
      await fs.writeFile(
        path.join(scriptsDir, 'setup-new-worktree.sh'),
        ['#!/usr/bin/env bash', 'set -euo pipefail', 'printf "%s\\n%s\\n" "$PWD" "$MAIN_REPO_ROOT" > setup-output.txt', ''].join('\n')
      );

      const realWorktreePath = await fs.realpath(worktreePath);

      await expect(runWorktreeSetup('/source/repo', worktreePath)).resolves.toBe(true);

      await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe(`${realWorktreePath}\n/source/repo\n`);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
