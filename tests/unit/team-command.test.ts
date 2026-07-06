import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { registerTeamCommands, type TeamCommandDeps } from '../../src/commands/team.js';
import { writeTeamPlan } from '../../src/planner/store.js';
import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';
import { TeamLifecycleManager } from '../../src/teams/manager.js';
import { writeTeamRuntimeSnapshot } from '../../src/teams/store.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const definition: TeamDefinition = {
  roles: [{ name: 'Engineer', host: 'cursor', responsibility: 'Ship feature', count: 1 }]
};

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-team-cmd-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function buildHarness(
  worktreePath: string,
  overrides: Partial<TeamCommandDeps> = {}
): {
  program: Command;
  io: CapturedIo;
  deps: TeamCommandDeps;
} {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const appendEvent = vi.fn();
  const deps: TeamCommandDeps = {
    resolveRepoRoot: vi.fn().mockResolvedValue(worktreePath),
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    resolveIssueNumber: vi.fn().mockResolvedValue(41),
    readState: vi.fn().mockResolvedValue('approved'),
    writeState: vi.fn().mockResolvedValue(undefined),
    readTeamPlan: vi.fn().mockResolvedValue(definition),
    createTeamManager: vi.fn().mockImplementation(({ worktreePath: wt, issueNumber }) => {
      const eventLog = {
        path: '/tmp/state.db',
        append: appendEvent,
        list: () => [],
        close: () => {}
      };
      return new TeamLifecycleManager({
        worktreePath: wt,
        issueNumber,
        eventLog,
        adapterFactory: {
          create: () =>
            new (class {
              async start() {}
              async stop() {}
              async send() {
                return { output: 'ok' };
              }
              async status() {
                return { state: 'running' as const };
              }
            })()
        }
      });
    }),
    readTeamRuntimeSnapshot: vi.fn().mockResolvedValue(null),
    writeTeamRuntimeSnapshot: vi.fn().mockResolvedValue(undefined),
    appendEvent,
    env: { FREESOLO_ENGINE: '1' },
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
  registerTeamCommands(program, deps);
  return { program, io, deps };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('freesolo team start', () => {
  it('creates a team and transitions approved to implementing', async () => {
    const worktreePath = await makeWorktree();
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'freesolo', 'team', 'start', '--issue', '41']);

    expect(deps.writeState).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets' },
      41,
      'approved',
      'implementing'
    );
    expect(io.stdout.join('')).toContain('team started: 1 members');
    expect(io.exitCode).toBeNull();
  });

  it('rejects start when workflow state is not approved', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged')
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'start', '--issue', '41']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('approved');
  });

  it('requires FREESOLO_ENGINE for start', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, { env: {} });

    await program.parseAsync(['node', 'freesolo', 'team', 'start', '--issue', '41']);

    expect(io.exitCode).toBe(3);
    expect(io.stderr.join('')).toContain('engine-only');
  });
});

describe('freesolo team status', () => {
  it('exits 2 when no snapshot exists', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readTeamRuntimeSnapshot: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'status', '--issue', '41']);

    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('no active team');
  });

  it('prints runtime snapshot JSON', async () => {
    const worktreePath = await makeWorktree();
    const snapshot = { issueNumber: 41, phase: 'running' as const, members: [] };
    const { program, io } = buildHarness(worktreePath, {
      readTeamRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot)
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'status', '--issue', '41']);

    expect(JSON.parse(io.stdout.join(''))).toEqual(snapshot);
  });
});

describe('freesolo team stop', () => {
  it('cancels from snapshot and emits teardown events', async () => {
    const worktreePath = await makeWorktree();
    const snapshot = {
      issueNumber: 41,
      phase: 'running' as const,
      members: [{ memberId: 'engineer-1', roleName: 'Engineer', host: 'cursor' as const, state: 'running' as const }]
    };
    const appendEvent = vi.fn();
    const { program, io } = buildHarness(worktreePath, {
      readTeamRuntimeSnapshot: vi.fn().mockResolvedValue(snapshot),
      appendEvent
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'stop', '--issue', '41']);

    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'team.tearing-down' }));
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'agent.stopped' }));
    expect(appendEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'team.torn-down' }));
    expect(io.stdout.join('')).toContain('team stopped (cancelled)');
  });

  it('exits 2 when no snapshot exists', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readTeamRuntimeSnapshot: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'stop', '--issue', '41']);

    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('no active team');
  });

  it('exits 2 when snapshot is already stopped', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readTeamRuntimeSnapshot: vi.fn().mockResolvedValue({
        issueNumber: 41,
        phase: 'stopped',
        members: []
      })
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'stop', '--issue', '41']);

    expect(io.exitCode).toBe(2);
  });

  it('reads team plan in integration-style worktree for start', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    await writeTeamRuntimeSnapshot(worktreePath, {
      issueNumber: 41,
      phase: 'running',
      members: []
    });
    const { program, io } = buildHarness(worktreePath, {
      readTeamRuntimeSnapshot: vi.fn(async (wt) => {
        const { readTeamRuntimeSnapshot } = await import('../../src/teams/store.js');
        return readTeamRuntimeSnapshot(wt);
      })
    });

    await program.parseAsync(['node', 'freesolo', 'team', 'status', '--issue', '41']);
    expect(io.stdout.join('')).toContain('"phase": "running"');
  });
});
