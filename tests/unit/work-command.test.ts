import { describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import {
  buildWorkerCommand,
  buildWorkerPrompt,
  registerWorkCommand,
  type WorkCommandDeps,
  type WorkVerifyResult
} from '../../src/commands/work.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface HarnessOptions {
  sessionPolls?: boolean[]; // sequence returned by tmuxHasSession after launch
  commits?: number;
  verify?: Partial<WorkVerifyResult>;
  sessionAlreadyRunning?: boolean;
}

function buildHarness(options: HarnessOptions = {}) {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const polls = [...(options.sessionPolls ?? [false])];
  let launched = false;

  const deps: WorkCommandDeps = {
    resolveRepoRoot: vi.fn().mockResolvedValue('/repo'),
    fetchIssue: vi
      .fn()
      .mockResolvedValue({ number: 24, title: 'Fix widget', body: 'The widget is broken.' }),
    ensureWorktree: vi.fn().mockResolvedValue({
      branchName: 'issue/24-fix-widget',
      worktreePath: '/wt/repo-24-fix-widget',
      reused: false
    }),
    defaultBranch: vi.fn().mockResolvedValue('main'),
    writeStateFile: vi
      .fn()
      .mockImplementation(async (_wt: string, name: string) => `/wt/.git/freesolo/${name}`),
    countCommits: vi.fn().mockResolvedValue(options.commits ?? 3),
    tmuxHasSession: vi.fn().mockImplementation(async () => {
      if (!launched) {
        return options.sessionAlreadyRunning ?? false;
      }
      return polls.length > 0 ? (polls.shift() as boolean) : false;
    }),
    tmuxNewSession: vi.fn().mockImplementation(async () => {
      launched = true;
    }),
    runVerify: vi.fn().mockResolvedValue({
      status: 'pass',
      attemptsUsed: 1,
      maxAttempts: 5,
      runDirectory: '/wt/.freesolo/runs/r1',
      ...options.verify
    }),
    createPullRequest: vi.fn().mockResolvedValue('https://github.com/acme/widgets/pull/9'),
    sleep: vi.fn().mockResolvedValue(undefined),
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    }
  };

  const program = new Command();
  program.exitOverride();
  registerWorkCommand(program, deps);
  return { program, io, deps };
}

describe('freesolo work', () => {
  it('runs worktree → tmux worker → gate route → PR on the happy path', async () => {
    const { program, io, deps } = buildHarness({ sessionPolls: [true, true, false] });

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--tool', 'claude']);

    expect(deps.ensureWorktree).toHaveBeenCalledWith('/repo', {
      number: 24,
      title: 'Fix widget',
      body: 'The widget is broken.'
    });
    expect(deps.tmuxNewSession).toHaveBeenCalledWith(
      'freesolo-24',
      '/wt/repo-24-fix-widget',
      expect.stringContaining('claude -p')
    );
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.runVerify).toHaveBeenCalledWith(
      '/wt/repo-24-fix-widget',
      24,
      'issue/24-fix-widget',
      'main'
    );
    expect(io.stdout.join('')).toContain('tmux attach -t freesolo-24');
    expect(io.stdout.join('')).toContain('PR created: https://github.com/acme/widgets/pull/9');
    expect(io.exitCode).toBeNull();
  });

  it('refuses to start when the tmux session already exists', async () => {
    const { program, io, deps } = buildHarness({ sessionAlreadyRunning: true });

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--tool', 'claude']);

    expect(deps.tmuxNewSession).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('already running');
  });

  it('stops with exit 1 when the worker leaves no commits', async () => {
    const { program, io, deps } = buildHarness({ commits: 0 });

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--tool', 'codex']);

    expect(deps.runVerify).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('no commits');
  });

  it('reports manual input required when the gate route stays red after max attempts', async () => {
    const { program, io, deps } = buildHarness({
      verify: { status: 'fail', attemptsUsed: 5, maxAttempts: 5 }
    });

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--tool', 'claude']);

    expect(deps.createPullRequest).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(1);
    const stderr = io.stderr.join('');
    expect(stderr).toContain('5/5 attempts');
    expect(stderr).toContain('manual input required');
    expect(stderr).toContain('/wt/.freesolo/runs/r1');
  });

  it('surfaces unexpected errors with exit 1', async () => {
    const { program, io, deps } = buildHarness();
    (deps.ensureWorktree as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Worktrunk is required')
    );

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--tool', 'claude']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('Worktrunk is required');
  });
});

describe('worker prompt and command', () => {
  it('builds a prompt that tells the agent to commit and exit', () => {
    const prompt = buildWorkerPrompt(
      { number: 24, title: 'Fix widget', body: 'Details.' },
      'issue/24-fix-widget'
    );
    expect(prompt).toContain('# Issue #24: Fix widget');
    expect(prompt).toContain('issue/24-fix-widget');
    expect(prompt).toContain('Commit all of your work');
  });

  it('builds host-specific worker commands reading the prompt file', () => {
    expect(buildWorkerCommand('claude', '/p/prompt.md')).toContain("claude -p \"$(cat '/p/prompt.md')\"");
    expect(buildWorkerCommand('codex', '/p/prompt.md')).toContain('codex exec --full-auto');
    expect(buildWorkerCommand('cursor', '/p/prompt.md')).toContain('cursor-agent -p');
  });
});
