import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import {
  assertPrGate,
  prCreateAction,
  registerPrCommands,
  showAction,
  type PrCommandDeps
} from '../../src/commands/pr.js';
import { getIssueflowPath } from '../../src/core/session-state.js';
import type { PullRequestOutcome, PullRequestRecord } from '../../src/integration/pr-types.js';
import type { VerificationRun } from '../../src/verification/types.js';
import { MultipleVerdictLabelsError } from '../../src/verification/verdict-store.js';
import type { RepoRef } from '../../src/core/types.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
const RUN_ID = '2026-06-01T08-00-00-000Z';

function makePassRun(): VerificationRun {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    issueNumber: 29,
    repoRoot: '/repo',
    configPath: '/repo/issueflow.config.json',
    startedAt: '2026-06-01T08:00:00.000Z',
    finishedAt: '2026-06-01T08:01:00.000Z',
    status: 'pass',
    bail: false,
    checks: []
  };
}

const createdOutcome: PullRequestOutcome = {
  status: 'created',
  prNumber: 99,
  prUrl: 'https://github.com/example/repo/pull/99',
  record: {
    issueNumber: 43,
    issueSlug: 'automated-pull-request-creation',
    prNumber: 99,
    prUrl: 'https://github.com/example/repo/pull/99',
    title: 'Issue #43: Automated Pull Request Creation',
    headBranch: 'candidate/43-automated-pull-request-creation',
    baseBranch: 'main',
    verificationRunId: '20260608-120000',
    implementationReviewPath: '/repo/review.md',
    specPath: '/repo/spec.md',
    createdAt: '2026-06-08T00:00:00.000Z'
  }
};

function makeDeps(overrides: Partial<PrCommandDeps> = {}): PrCommandDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    resolveRepoRef: async () => repo,
    resolveIssueNumber: async () => 29,
    readState: async () => 'pr-ready',
    readVerdict: async () => 'pass',
    loadLatestRun: async () => makePassRun(),
    readGateVerdictRecord: async () => ({
      schemaVersion: 1 as const,
      issueNumber: 29,
      runId: RUN_ID,
      outcome: 'pass' as const,
      reason: 'Verification run passed.',
      nextAction: 'Create a pull request.',
      evaluatedAt: '2026-06-01T08:02:00.000Z'
    }),
    createPullRequest: vi.fn().mockResolvedValue(createdOutcome),
    readPullRequestRecord: vi.fn(),
    runGh: vi.fn(),
    runGit: vi.fn(),
    write: () => {},
    setExitCode: () => {},
    ...overrides
  };
}

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-pr-cmd-'));
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

afterEach(async () => {
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('assertPrGate', () => {
  it('returns ok when state is pr-ready, verdict is pass, and runId matches', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: makePassRun(),
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(true);
  });

  it('returns not-ok when state is not pr-ready', () => {
    const result = assertPrGate({
      state: 'implementing',
      verdict: 'pass',
      latestRun: makePassRun(),
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pr-ready/);
  });

  it('returns not-ok when verdict is not pass', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: null,
      latestRun: makePassRun(),
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
  });

  it('returns not-ok when latest run is fail', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: { ...makePassRun(), status: 'fail' },
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
  });

  it('returns not-ok when storedRunId is null (missing local gate record)', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: makePassRun(),
      storedRunId: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/gate verdict record/i);
  });

  it('returns not-ok when storedRunId does not match latestRun.runId (stale pass)', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: { ...makePassRun(), runId: 'newer-run-id' },
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale/i);
  });
});

describe('prCreateAction', () => {
  it('exits 1 and reports reason when gate check fails (state not pr-ready)', async () => {
    let exitCode = 99;
    const output: string[] = [];

    await prCreateAction(
      { printOnly: false },
      makeDeps({
        readState: async () => 'implementing',
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(exitCode).toBe(1);
    expect(output.join('')).toMatch(/pr-ready/);
  });

  it('reports would-pass and exits 0 when --print-only and gate passes', async () => {
    let exitCode = 99;
    const createCalls: unknown[] = [];
    const output: string[] = [];

    await prCreateAction(
      { printOnly: true },
      makeDeps({
        createPullRequest: vi.fn().mockImplementation(async (...args) => {
          createCalls.push(args);
          return createdOutcome;
        }),
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(createCalls).toEqual([]);
    expect(exitCode).toBe(0);
    expect(output.join('')).toMatch(/pass/i);
  });

  it('calls createPullRequest on happy path after gate passes', async () => {
    const createPullRequest = vi.fn().mockResolvedValue(createdOutcome);

    await prCreateAction({ printOnly: false }, makeDeps({ createPullRequest }));

    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 29, dryRun: false }),
      expect.any(Object)
    );
  });

  it('prints dry-run output when --dry-run and gate passes', async () => {
    const dryRunOutcome: PullRequestOutcome = {
      status: 'dry-run',
      title: 'Issue #43: Automated Pull Request Creation',
      body: 'Closes #43',
      headBranch: 'candidate/43-automated-pull-request-creation',
      baseBranch: 'main'
    };
    const output: string[] = [];

    await prCreateAction(
      { dryRun: true },
      makeDeps({
        createPullRequest: vi.fn().mockResolvedValue(dryRunOutcome),
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(output.join('')).toContain('Closes #43');
  });

  it('maps gh-error to exit code 3', async () => {
    let exitCode = 99;
    const { PullRequestError } = await import('../../src/integration/pr-types.js');

    await prCreateAction(
      {},
      makeDeps({
        createPullRequest: vi.fn().mockRejectedValue(new PullRequestError('gh-error', 'create failed')),
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );

    expect(exitCode).toBe(3);
  });

  it('exits 4 when readVerdict throws MultipleVerdictLabelsError', async () => {
    let exitCode = 99;
    const output: string[] = [];

    await prCreateAction(
      { printOnly: false },
      makeDeps({
        readVerdict: async () => {
          throw new MultipleVerdictLabelsError(29, ['verification:pass', 'verification:fail']);
        },
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(exitCode).toBe(4);
    expect(output.join('')).toMatch(/multiple/i);
  });

  it('resolves issue number from current branch when --issue is omitted', async () => {
    const worktreePath = await makeWorktree();
    await execa('git', ['checkout', '-b', 'issue/43-from-branch'], { cwd: worktreePath });
    const createPullRequest = vi.fn().mockResolvedValue(createdOutcome);
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };

    await prCreateAction(
      {},
      {
        ...makeDeps({ createPullRequest }),
        resolveRepoRoot: async () => worktreePath,
        resolveRepoRef: async () => repo,
        resolveIssueNumber: (repoRoot, override) =>
          import('../../src/core/issue-id.js').then((module) => module.resolveIssueNumber(repoRoot, override)),
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(0);
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 43 }),
      expect.any(Object)
    );
  });

  it('resolves issue number from session.json when --issue is omitted', async () => {
    const worktreePath = await makeWorktree();
    await writeIssueflowFile(
      worktreePath,
      'session.json',
      JSON.stringify({ issueNumber: 43, issueSlug: 'automated-pull-request-creation' })
    );
    const createPullRequest = vi.fn().mockResolvedValue(createdOutcome);
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };

    await prCreateAction(
      {},
      {
        ...makeDeps({ createPullRequest }),
        resolveRepoRoot: async () => worktreePath,
        resolveRepoRef: async () => repo,
        resolveIssueNumber: (repoRoot, override) =>
          import('../../src/core/issue-id.js').then((module) => module.resolveIssueNumber(repoRoot, override)),
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(0);
    expect(createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({ issueNumber: 43 }),
      expect.any(Object)
    );
  });
});

describe('pr showAction', () => {
  it('exits 2 when no provenance exists', async () => {
    const worktreePath = await makeWorktree();
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };

    await showAction(
      { issue: 43 },
      {
        ...makeDeps(),
        resolveRepoRoot: async () => worktreePath,
        resolveIssueNumber: async () => 43,
        readPullRequestRecord: vi.fn().mockResolvedValue(null),
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(2);
  });

  it('exits 2 when provenance record is invalid', async () => {
    const worktreePath = await makeWorktree();
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
    const { PullRequestError } = await import('../../src/integration/pr-types.js');

    await showAction(
      { issue: 43 },
      {
        ...makeDeps(),
        resolveRepoRoot: async () => worktreePath,
        resolveIssueNumber: async () => 43,
        readPullRequestRecord: vi.fn().mockRejectedValue(new PullRequestError('invalid-record', 'bad json')),
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('bad json');
  });

  it('prints provenance JSON with exit code 0', async () => {
    const worktreePath = await makeWorktree();
    const record: PullRequestRecord = createdOutcome.record;
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };

    await showAction(
      { issue: 43 },
      {
        ...makeDeps(),
        resolveRepoRoot: async () => worktreePath,
        resolveIssueNumber: async () => 43,
        readPullRequestRecord: vi.fn().mockResolvedValue(record),
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('')).toContain('"prNumber": 99');
  });
});

describe('registerPrCommands', () => {
  it('registers create and show subcommands', () => {
    const program = new Command();
    registerPrCommands(program, makeDeps());
    const pr = program.commands.find((command) => command.name() === 'pr');
    const subcommands = pr?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['create', 'show']));
  });
});
