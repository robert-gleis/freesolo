import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import {
  buildBranchName,
  ensureUniqueWorkspaceNames,
  ensureWorktrunkAvailable,
  findExistingWorkspaceMatch,
  resolveBranchWorktreePath,
  runWorktreeSetup,
  switchExistingIssueWorktree,
  switchNewIssueWorktree,
  WorktreeSetupError,
  WorktrunkMissingError,
  WorktrunkPathResolutionError
} from '../../src/core/worktree.js';

describe('findExistingWorkspaceMatch', () => {
  it('prefers an existing worktree for the issue branch', () => {
    const match = findExistingWorkspaceMatch(
      ['issue/12-ship-freesolo-start'],
      [{ branchName: 'issue/12-ship-freesolo-start', worktreePath: '/tmp/freesolo-12-ship-freesolo-start' }],
      12
    );

    expect(match?.worktreePath).toBe('/tmp/freesolo-12-ship-freesolo-start');
  });
});

describe('buildBranchName', () => {
  it('uses the neutral issue prefix', () => {
    expect(buildBranchName({ number: 12, slug: 'ship-freesolo-start' })).toBe('issue/12-ship-freesolo-start');
  });
});

describe('ensureUniqueWorkspaceNames', () => {
  it('appends a numeric suffix when the default branch and path already exist', () => {
    expect(
      ensureUniqueWorkspaceNames(
        '/repo/freesolo',
        { number: 12, slug: 'ship-freesolo-start' },
        ['issue/12-ship-freesolo-start'],
        [{ branchName: 'issue/12-ship-freesolo-start', worktreePath: '/repo/freesolo-12-ship-freesolo-start' }]
      )
    ).toEqual({
      branchName: 'issue/12-ship-freesolo-start-2',
      worktreePath: '/repo/freesolo-12-ship-freesolo-start-2'
    });
  });
});

describe('ensureWorktrunkAvailable', () => {
  it('returns when wt is available', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await expect(
      ensureWorktrunkAvailable(async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd });
      })
    ).resolves.toBeUndefined();

    expect(calls).toEqual([{ command: 'wt', args: ['--version'], cwd: undefined }]);
  });

  it('throws a clear error when wt is missing', async () => {
    await expect(
      ensureWorktrunkAvailable(async () => {
        const error = new Error('spawn wt ENOENT') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      })
    ).rejects.toMatchObject({
      name: 'WorktrunkMissingError',
      message: expect.stringContaining('Worktrunk is required')
    } satisfies Partial<WorktrunkMissingError>);
  });
});

describe('Worktrunk switch helpers', () => {
  it('creates a new issue workspace through wt switch --create', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await switchNewIssueWorktree('/repo', 'issue/12-ship-freesolo-start', async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
    });

    expect(calls).toEqual([
      {
        command: 'wt',
        args: ['switch', '--create', 'issue/12-ship-freesolo-start'],
        cwd: '/repo'
      }
    ]);
  });

  it('switches an existing issue branch through wt switch', async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

    await switchExistingIssueWorktree('/repo', 'issue/12-ship-freesolo-start', async (command, args, options) => {
      calls.push({ command, args, cwd: options?.cwd });
    });

    expect(calls).toEqual([
      {
        command: 'wt',
        args: ['switch', 'issue/12-ship-freesolo-start'],
        cwd: '/repo'
      }
    ]);
  });
});

describe('resolveBranchWorktreePath', () => {
  it('returns the worktree path for a branch', async () => {
    const branchPath = await resolveBranchWorktreePath('/repo', 'issue/12-ship-freesolo-start', async () => ({
      stdout: [
        'worktree /repo',
        'HEAD 1111111',
        'branch refs/heads/main',
        '',
        'worktree /worktrees/freesolo/12',
        'HEAD 2222222',
        'branch refs/heads/issue/12-ship-freesolo-start'
      ].join('\n')
    }));

    expect(branchPath).toBe('/worktrees/freesolo/12');
  });

  it('throws when the branch has no resolved worktree', async () => {
    await expect(
      resolveBranchWorktreePath('/repo', 'issue/12-ship-freesolo-start', async () => ({
        stdout: ['worktree /repo', 'HEAD 1111111', 'branch refs/heads/main'].join('\n')
      }))
    ).rejects.toMatchObject({
      name: 'WorktrunkPathResolutionError',
      message: expect.stringContaining('Could not resolve Worktrunk checkout')
    } satisfies Partial<WorktrunkPathResolutionError>);
  });
});

describe('runWorktreeSetup', () => {
  it('returns false when the worktree does not define a setup hook', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-worktree-'));

    try {
      await expect(runWorktreeSetup('/repo', worktreePath)).resolves.toBe(false);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it('runs the setup hook from the worktree with the source checkout in MAIN_REPO_ROOT', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-worktree-'));
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

  it('does not stream successful setup hook output to the terminal', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-worktree-'));
    const scriptsDir = path.join(worktreePath, 'scripts');
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    let terminalOutput = '';

    try {
      await fs.mkdir(scriptsDir);
      await fs.writeFile(
        path.join(scriptsDir, 'setup-new-worktree.sh'),
        ['#!/usr/bin/env bash', 'set -euo pipefail', 'echo "noisy stdout"', 'echo "noisy stderr" >&2', ''].join('\n')
      );

      process.stdout.write = ((chunk: string | Uint8Array) => {
        terminalOutput += chunk.toString();
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        terminalOutput += chunk.toString();
        return true;
      }) as typeof process.stderr.write;

      await expect(runWorktreeSetup('/source/repo', worktreePath)).resolves.toBe(true);

      expect(terminalOutput).toBe('');
    } finally {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it('shows spinner status when a setup hook runs with a TTY stream', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-worktree-'));
    const scriptsDir = path.join(worktreePath, 'scripts');
    const writes: string[] = [];
    const stream = {
      isTTY: true,
      write: (chunk: string | Uint8Array) => {
        writes.push(chunk.toString());
        return true;
      }
    } as NodeJS.WriteStream;

    try {
      await fs.mkdir(scriptsDir);
      await fs.writeFile(path.join(scriptsDir, 'setup-new-worktree.sh'), ['#!/usr/bin/env bash', 'set -euo pipefail', ''].join('\n'));

      await expect(
        runWorktreeSetup('/source/repo', worktreePath, {
          spinnerLabel: 'Running worktree setup',
          stream
        })
      ).resolves.toBe(true);

      expect(writes.join('')).toContain('Running worktree setup');
      expect(writes.join('')).toContain('Done: Running worktree setup');
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });

  it('includes captured setup hook output when the hook fails', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-worktree-'));
    const scriptsDir = path.join(worktreePath, 'scripts');

    try {
      await fs.mkdir(scriptsDir);
      await fs.writeFile(
        path.join(scriptsDir, 'setup-new-worktree.sh'),
        ['#!/usr/bin/env bash', 'set -euo pipefail', 'echo "installing deps"', 'echo "turbo failed" >&2', 'exit 1', ''].join('\n')
      );

      await expect(runWorktreeSetup('/source/repo', worktreePath)).rejects.toMatchObject({
        name: 'WorktreeSetupError',
        message: expect.stringMatching(/Worktree setup failed[\s\S]*installing deps[\s\S]*turbo failed/)
      } satisfies Partial<WorktreeSetupError>);
    } finally {
      await fs.rm(worktreePath, { recursive: true, force: true });
    }
  });
});
