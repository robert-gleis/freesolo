import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { agentsListAction, registerAgentsCommands, type AgentsCommandDeps } from '../../src/commands/agents.js';
import type { TeamRuntimeSnapshot } from '../../src/teams/types.js';
import type { WorktreeRecord } from '../../src/worktree-metadata/store.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const worktreeRow = (id: number, path: string, issueId: number): WorktreeRecord => ({
  id,
  path,
  branch: `issue/${issueId}`,
  agentOwner: 'claude',
  issueId,
  createdAt: '2026-07-06T10:00:00.000Z',
  lastSeenAt: '2026-07-06T10:00:00.000Z'
});

const runningSnapshot: TeamRuntimeSnapshot = {
  issueNumber: 42,
  phase: 'running',
  startedAt: '2026-07-06T10:00:00.000Z',
  members: [
    { memberId: 'agent-1', roleName: 'implementer', host: 'claude-code', state: 'running' },
    { memberId: 'agent-2', roleName: 'reviewer', host: 'claude-code', state: 'idle', blockedReason: 'awaiting review' }
  ]
};

const stoppedSnapshot: TeamRuntimeSnapshot = {
  issueNumber: 17,
  phase: 'stopped',
  stoppedAt: '2026-07-06T09:00:00.000Z',
  stopReason: 'completed',
  members: [{ memberId: 'agent-9', roleName: 'implementer', host: 'claude-code', state: 'stopped' }]
};

function buildHarness(overrides: Partial<AgentsCommandDeps> = {}): {
  program: Command;
  io: CapturedIo;
  deps: AgentsCommandDeps;
} {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const snapshots: Record<string, TeamRuntimeSnapshot | null> = {
    '/wt/running': runningSnapshot,
    '/wt/stopped': stoppedSnapshot,
    '/wt/no-team': null
  };
  const deps: AgentsCommandDeps = {
    getWorktreeStore: vi.fn().mockReturnValue({
      list: vi
        .fn()
        .mockReturnValue([
          worktreeRow(1, '/wt/running', 42),
          worktreeRow(2, '/wt/stopped', 17),
          worktreeRow(3, '/wt/no-team', 5)
        ])
    }),
    readTeamRuntimeSnapshot: vi.fn(async (path: string) => snapshots[path] ?? null),
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    },
    ...overrides
  } as AgentsCommandDeps;
  const program = new Command();
  program.exitOverride();
  registerAgentsCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('freesolo agents list', () => {
  it('shows only active teams by default, one line per member', async () => {
    const { program, io } = buildHarness();

    await program.parseAsync(['node', 'freesolo', 'agents', 'list']);

    const out = io.stdout.join('');
    expect(out).toContain('agent-1');
    expect(out).toContain('awaiting review');
    expect(out).not.toContain('agent-9');
    expect(out).not.toContain('/wt/no-team');
    expect(io.exitCode).toBeNull();
  });

  it('includes stopped teams and team-less worktrees with --all', async () => {
    const { program, io } = buildHarness();

    await program.parseAsync(['node', 'freesolo', 'agents', 'list', '--all']);

    const out = io.stdout.join('');
    expect(out).toContain('agent-9');
    expect(out).toContain('/wt/no-team');
    expect(out).toContain('no team');
  });

  it('prints JSON when --json is set', async () => {
    const { program, io } = buildHarness();

    await program.parseAsync(['node', 'freesolo', 'agents', 'list', '--json']);

    const entries = JSON.parse(io.stdout.join(''));
    expect(entries).toHaveLength(1);
    expect(entries[0].snapshot.issueNumber).toBe(42);
  });

  it('treats unreadable worktrees as having no team instead of failing', async () => {
    const { io, deps } = buildHarness({
      readTeamRuntimeSnapshot: vi.fn().mockRejectedValue(new Error('not a git repo'))
    });

    await agentsListAction({ all: true }, deps);

    expect(io.stdout.join('')).toContain('no team');
    expect(io.exitCode).toBeNull();
  });

  it('prints a friendly message when nothing is running', async () => {
    const { io, deps } = buildHarness({
      getWorktreeStore: vi.fn().mockReturnValue({ list: vi.fn().mockReturnValue([]) })
    });

    await agentsListAction({}, deps);

    expect(io.stdout.join('')).toContain('No agent teams found');
    expect(io.exitCode).toBeNull();
  });

  it('sets exit code 2 on operational error', async () => {
    const { io, deps } = buildHarness({
      getWorktreeStore: vi.fn(() => {
        throw new Error('disk full');
      })
    });

    await agentsListAction({}, deps);

    expect(io.stderr.join('')).toContain('disk full');
    expect(io.exitCode).toBe(2);
  });
});
