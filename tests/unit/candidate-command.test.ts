import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import {
  createAction,
  registerCandidateCommands,
  resolveIssueSlug,
  showAction,
  type CandidateCommandDeps
} from '../../src/commands/candidate.js';
import { getIssueflowPath } from '../../src/core/session-state.js';
import type { CandidateBranchOutcome } from '../../src/integration/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-candidate-cmd-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}

async function writeIssueflowFile(worktreePath: string, filename: string, contents: string): Promise<void> {
  const rawPath = await getIssueflowPath(worktreePath, filename);
  const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, contents);
}

function buildHarness(
  worktreePath: string,
  overrides: Partial<CandidateCommandDeps> = {}
): { program: Command; io: CapturedIo; deps: CandidateCommandDeps } {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: CandidateCommandDeps = {
    resolveRepoRoot: vi.fn().mockResolvedValue(worktreePath),
    resolveIssueSlug: vi.fn().mockResolvedValue('candidate-branch-creation'),
    createCandidateBranch: vi.fn(),
    readCandidateBranchRecord: vi.fn(),
    runGit: vi.fn(),
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    },
    ...overrides
  };

  const program = new Command();
  program.exitOverride();
  registerCandidateCommands(program, deps);
  return { program, io, deps };
}

const createdOutcome: CandidateBranchOutcome = {
  status: 'created',
  branchName: 'candidate/35-candidate-branch-creation',
  mergeCommitSha: 'deadbeef',
  record: {
    branchName: 'candidate/35-candidate-branch-creation',
    issueNumber: 35,
    issueSlug: 'candidate-branch-creation',
    teamId: 'team-1',
    sources: [{ branchName: 'issue/35-a', ownerKind: 'team', ownerId: 'team-1' }],
    baseBranch: 'main',
    mergeCommitSha: 'deadbeef',
    status: 'ready',
    createdAt: '2026-06-08T00:00:00.000Z',
    updatedAt: '2026-06-08T00:00:00.000Z'
  }
};

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('resolveIssueSlug', () => {
  it('prefers current-issue.md branch line', async () => {
    const worktreePath = await makeWorktree();
    await writeIssueflowFile(
      worktreePath,
      'current-issue.md',
      ['# Issue #35: Candidate Branch Creation', '', '## Branch', 'issue/35-from-packet', ''].join('\n')
    );
    await writeIssueflowFile(
      worktreePath,
      'session.json',
      JSON.stringify({ issueNumber: 35, issueSlug: 'from-session' })
    );

    await expect(resolveIssueSlug(worktreePath, 35)).resolves.toBe('from-packet');
  });

  it('falls back to session.json issueSlug', async () => {
    const worktreePath = await makeWorktree();
    await writeIssueflowFile(
      worktreePath,
      'session.json',
      JSON.stringify({ issueNumber: 35, issueSlug: 'from-session' })
    );

    await expect(resolveIssueSlug(worktreePath, 35)).resolves.toBe('from-session');
  });

  it('derives slug from current branch', async () => {
    const worktreePath = await makeWorktree();
    await execa('git', ['checkout', '-b', 'issue/35-from-branch'], { cwd: worktreePath });
    await expect(resolveIssueSlug(worktreePath, 35)).resolves.toBe('from-branch');
  });
});

describe('candidate create command', () => {
  it('exits 0 on created outcome', async () => {
    const worktreePath = await makeWorktree();
    const { io, deps } = buildHarness(worktreePath, {
      createCandidateBranch: vi.fn().mockResolvedValue(createdOutcome)
    });

    await createAction(
      { issue: 35, team: 'team-1', branches: 'issue/35-a', base: 'main', force: false },
      deps
    );

    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('')).toContain('created');
  });

  it('exits 0 on already-exists outcome', async () => {
    const worktreePath = await makeWorktree();
    const { io, deps } = buildHarness(worktreePath, {
      createCandidateBranch: vi.fn().mockResolvedValue({
        status: 'already-exists',
        branchName: 'candidate/35-candidate-branch-creation',
        record: createdOutcome.record
      })
    });

    await createAction({ issue: 35, team: 'team-1', branches: 'issue/35-a' }, deps);
    expect(io.exitCode).toBe(0);
  });

  it('exits 1 on conflict with JSON on stderr', async () => {
    const worktreePath = await makeWorktree();
    const { io, deps } = buildHarness(worktreePath, {
      createCandidateBranch: vi.fn().mockResolvedValue({
        status: 'conflict',
        branchName: 'candidate/35-candidate-branch-creation',
        conflictingBranch: 'issue/35-b',
        conflictedFiles: ['file.txt'],
        gitOutput: 'CONFLICT',
        record: { ...createdOutcome.record, status: 'conflict', mergeCommitSha: null }
      })
    });

    await createAction({ issue: 35, team: 'team-1', branches: 'issue/35-a,issue/35-b' }, deps);
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('conflict');
  });

  it('exits 2 on validation error for empty branches', async () => {
    const worktreePath = await makeWorktree();
    const { io, deps } = buildHarness(worktreePath);

    await createAction({ issue: 35, team: 'team-1', branches: ' , ' }, deps);
    expect(io.exitCode).toBe(2);
  });

  it('exits 3 on git-error', async () => {
    const worktreePath = await makeWorktree();
    const { CandidateBranchError } = await import('../../src/integration/types.js');
    const { io, deps } = buildHarness(worktreePath, {
      createCandidateBranch: vi.fn().mockRejectedValue(new CandidateBranchError('git-error', 'checkout failed'))
    });

    await createAction({ issue: 35, team: 'team-1', branches: 'issue/35-a' }, deps);
    expect(io.exitCode).toBe(3);
  });

  it('forwards --base and --force to createCandidateBranch', async () => {
    const worktreePath = await makeWorktree();
    const createCandidateBranch = vi.fn().mockResolvedValue(createdOutcome);
    const { deps } = buildHarness(worktreePath, { createCandidateBranch });

    await createAction(
      { issue: 35, team: 'team-1', branches: 'issue/35-a', base: 'develop', force: true },
      deps
    );

    expect(createCandidateBranch).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: 'develop', force: true }),
      expect.any(Object)
    );
  });
});

describe('candidate show command', () => {
  it('exits 2 when no record exists', async () => {
    const worktreePath = await makeWorktree();
    const { io, deps } = buildHarness(worktreePath, {
      readCandidateBranchRecord: vi.fn().mockResolvedValue(null)
    });

    await showAction({ issue: 35 }, deps);
    expect(io.exitCode).toBe(2);
  });

  it('prints record on success', async () => {
    const worktreePath = await makeWorktree();
    const { io, deps } = buildHarness(worktreePath, {
      readCandidateBranchRecord: vi.fn().mockResolvedValue(createdOutcome.record)
    });

    await showAction({ issue: 35 }, deps);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('')).toContain('candidate/35-candidate-branch-creation');
  });
});
