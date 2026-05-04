import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBranchName,
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
