import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPullRequest } from '../../src/integration/pr-creator.js';
import { writePullRequestRecord } from '../../src/integration/pr-store.js';
import { PullRequestError } from '../../src/integration/pr-types.js';
import type { PullRequestRecord } from '../../src/integration/pr-types.js';
import { writeCandidateBranchRecord } from '../../src/integration/store.js';
import type { CandidateBranchRecord } from '../../src/integration/types.js';
import { writeRun } from '../../src/verification/store.js';
import type { VerificationRun } from '../../src/verification/types.js';

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-pr-creator-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  await execa('git', ['remote', 'add', 'origin', 'git@github.com:example/repo.git'], { cwd: dir });
  return dir;
}

const candidateRecord: CandidateBranchRecord = {
  branchName: 'candidate/43-automated-pull-request-creation',
  issueNumber: 43,
  issueSlug: 'automated-pull-request-creation',
  teamId: 'team-1',
  sources: [{ branchName: 'issue/43-a', ownerKind: 'team', ownerId: 'team-1' }],
  baseBranch: 'main',
  mergeCommitSha: 'abc123',
  status: 'ready',
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:00.000Z'
};

const passingRun: VerificationRun = {
  schemaVersion: 1,
  runId: '20260608-120000',
  issueNumber: 43,
  repoRoot: '',
  configPath: '/repo/issueflow.config.json',
  startedAt: '2026-06-08T12:00:00.000Z',
  finishedAt: '2026-06-08T12:00:05.000Z',
  status: 'pass',
  bail: false,
  checks: [
    {
      name: 'unit-tests',
      command: 'npm',
      args: ['test'],
      cwd: '/repo',
      status: 'pass',
      exitCode: 0,
      signal: null,
      startedAt: '2026-06-08T12:00:01.000Z',
      finishedAt: '2026-06-08T12:00:04.000Z',
      durationMs: 3000,
      logPath: 'unit-tests.log'
    }
  ]
};

async function seedArtifacts(repoRoot: string): Promise<void> {
  await fs.mkdir(path.join(repoRoot, 'docs/issueflow/specs'), { recursive: true });
  await fs.mkdir(path.join(repoRoot, 'docs/issueflow/reviews'), { recursive: true });

  await fs.writeFile(
    path.join(repoRoot, 'docs/issueflow/specs/2026-06-08-issue-43-design.md'),
    '# Spec\n\n## Summary\n\nShip PR automation.\n'
  );
  await fs.writeFile(
    path.join(repoRoot, 'docs/issueflow/reviews/2026-06-08-issue-43-implementation-review-round-1.md'),
    '## Verdict\npass\n'
  );
}

async function seedReadyRepo(repoRoot: string): Promise<void> {
  await writeCandidateBranchRecord(repoRoot, candidateRecord);
  const run = { ...passingRun, repoRoot };
  await writeRun(run);
  await seedArtifacts(repoRoot);
}

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('createPullRequest', () => {
  it('throws candidate-not-ready when no candidate record exists', async () => {
    const repoRoot = await makeWorktree();

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi.fn(),
          runGit: vi.fn(),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'candidate-not-ready' });
  });

  it('throws candidate-not-ready when candidate status is conflict', async () => {
    const repoRoot = await makeWorktree();
    await writeCandidateBranchRecord(repoRoot, { ...candidateRecord, status: 'conflict', mergeCommitSha: null });
    await writeRun({ ...passingRun, repoRoot });
    await seedArtifacts(repoRoot);

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi.fn(),
          runGit: vi.fn(),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'candidate-not-ready' });
  });

  it('throws verification-not-passed when no verification run exists', async () => {
    const repoRoot = await makeWorktree();
    await writeCandidateBranchRecord(repoRoot, candidateRecord);
    await seedArtifacts(repoRoot);

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi.fn(),
          runGit: vi.fn(),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'verification-not-passed' });
  });

  it('throws verification-not-passed when latest run failed', async () => {
    const repoRoot = await makeWorktree();
    await writeCandidateBranchRecord(repoRoot, candidateRecord);
    await writeRun({ ...passingRun, repoRoot, status: 'fail' });
    await seedArtifacts(repoRoot);

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi.fn(),
          runGit: vi.fn(),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'verification-not-passed' });
  });

  it('throws review-artifact-missing when no review artifact exists', async () => {
    const repoRoot = await makeWorktree();
    await writeCandidateBranchRecord(repoRoot, candidateRecord);
    await writeRun({ ...passingRun, repoRoot });

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi.fn(),
          runGit: vi.fn(),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'review-artifact-missing' });
  });

  it('returns dry-run without calling gh pr create', async () => {
    const repoRoot = await makeWorktree();
    await seedReadyRepo(repoRoot);
    const runGh = vi.fn();
    const runGit = vi.fn();

    const outcome = await createPullRequest(
      { repoRoot, issueNumber: 43, dryRun: true },
      {
        runGh,
        runGit,
        readFile: fs.readFile,
        writeFile: fs.writeFile
      }
    );

    expect(outcome.status).toBe('dry-run');
    if (outcome.status === 'dry-run') {
      expect(outcome.title).toContain('Issue #43');
      expect(outcome.body).toContain('Closes #43');
      expect(outcome.headBranch).toBe(candidateRecord.branchName);
    }
    expect(runGh).not.toHaveBeenCalled();
    expect(runGit).not.toHaveBeenCalled();
  });

  it('creates a pull request and writes provenance', async () => {
    const repoRoot = await makeWorktree();
    await seedReadyRepo(repoRoot);

    const runGit = vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    const runGh = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '[]', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: 'https://github.com/example/repo/pull/99\n',
        stderr: '',
        exitCode: 0
      });

    const outcome = await createPullRequest(
      { repoRoot, issueNumber: 43 },
      {
        runGh,
        runGit,
        readFile: fs.readFile,
        writeFile: fs.writeFile,
        now: () => new Date('2026-06-08T12:00:00.000Z')
      }
    );

    expect(outcome.status).toBe('created');
    if (outcome.status === 'created') {
      expect(outcome.prNumber).toBe(99);
      expect(outcome.record.verificationRunId).toBe('20260608-120000');
    }
    expect(runGit).toHaveBeenCalledWith(['push', '-u', 'origin', candidateRecord.branchName], { cwd: repoRoot });
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it('returns already-exists when provenance record already exists', async () => {
    const repoRoot = await makeWorktree();
    await seedReadyRepo(repoRoot);

    const existingRecord: PullRequestRecord = {
      issueNumber: 43,
      issueSlug: 'automated-pull-request-creation',
      prNumber: 55,
      prUrl: 'https://github.com/example/repo/pull/55',
      title: 'Issue #43: Automated Pull Request Creation',
      headBranch: candidateRecord.branchName,
      baseBranch: 'main',
      verificationRunId: '20260608-120000',
      implementationReviewPath: '/repo/review.md',
      specPath: '/repo/spec.md',
      createdAt: '2026-06-08T00:00:00.000Z'
    };
    await writePullRequestRecord(repoRoot, existingRecord);

    const outcome = await createPullRequest(
      { repoRoot, issueNumber: 43 },
      {
        runGh: vi.fn(),
        runGit: vi.fn(),
        readFile: fs.readFile,
        writeFile: fs.writeFile
      }
    );

    expect(outcome.status).toBe('already-exists');
    if (outcome.status === 'already-exists') {
      expect(outcome.prNumber).toBe(55);
    }
  });

  it('throws git-error when git push fails', async () => {
    const repoRoot = await makeWorktree();
    await seedReadyRepo(repoRoot);

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi.fn().mockResolvedValue({ stdout: '[]', stderr: '', exitCode: 0 }),
          runGit: vi.fn().mockResolvedValue({ stdout: '', stderr: 'push failed', exitCode: 1 }),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'git-error' });
  });

  it('throws gh-error when gh pr create fails', async () => {
    const repoRoot = await makeWorktree();
    await seedReadyRepo(repoRoot);

    await expect(
      createPullRequest(
        { repoRoot, issueNumber: 43 },
        {
          runGh: vi
            .fn()
            .mockResolvedValueOnce({ stdout: '[]', stderr: '', exitCode: 0 })
            .mockResolvedValueOnce({ stdout: '', stderr: 'create failed', exitCode: 1 }),
          runGit: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
          readFile: fs.readFile,
          writeFile: fs.writeFile
        }
      )
    ).rejects.toMatchObject({ code: 'gh-error' });
  });

  it('returns already-exists when gh reports an open pull request', async () => {
    const repoRoot = await makeWorktree();
    await seedReadyRepo(repoRoot);

    const runGh = vi.fn().mockResolvedValue({
      stdout: JSON.stringify([{ number: 77, url: 'https://github.com/example/repo/pull/77', state: 'OPEN' }]),
      stderr: '',
      exitCode: 0
    });

    const outcome = await createPullRequest(
      { repoRoot, issueNumber: 43 },
      {
        runGh,
        runGit: vi.fn(),
        readFile: fs.readFile,
        writeFile: fs.writeFile,
        now: () => new Date('2026-06-08T12:00:00.000Z')
      }
    );

    expect(outcome.status).toBe('already-exists');
    if (outcome.status === 'already-exists') {
      expect(outcome.prNumber).toBe(77);
    }
  });
});
