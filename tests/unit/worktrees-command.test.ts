import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { driftAction, listAction, registerWorktreesCommands, type WorktreesCommandDeps } from '../../src/commands/worktrees.js';
import { StateStoreError } from '../../src/state-store/types.js';
import type { WorktreeRecord } from '../../src/worktree-metadata/store.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: WorktreesCommandDeps;
}

const sampleRows: WorktreeRecord[] = [
  {
    id: 1,
    path: '/repo/.worktrees/wt-a',
    branch: 'issue/1',
    agentOwner: 'cursor',
    issueId: 1,
    createdAt: '2026-06-05T10:00:00.000Z',
    lastSeenAt: '2026-06-05T10:00:00.000Z'
  }
];

function buildHarness(overrides: Partial<WorktreesCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const mockStore = {
    list: vi.fn().mockReturnValue(sampleRows),
    upsert: vi.fn(),
    getByPath: vi.fn(),
    deleteByPath: vi.fn(),
    touch: vi.fn()
  };
  const deps: WorktreesCommandDeps = {
    getWorktreeStore: vi.fn().mockReturnValue(mockStore),
    resolveRepoRoot: vi.fn().mockResolvedValue('/repo'),
    listWorktreeEntries: vi.fn().mockResolvedValue([
      { worktreePath: '/repo/.worktrees/wt-a', branchName: 'issue/1' }
    ]),
    pathExists: vi.fn().mockResolvedValue(true),
    env: process.env,
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
  registerWorktreesCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('freesolo worktrees list', () => {
  it('prints rows from the store', async () => {
    const { program, io } = buildHarness();

    await program.parseAsync(['node', 'freesolo', 'worktrees', 'list']);

    expect(io.stdout.join('')).toContain('/repo/.worktrees/wt-a');
    expect(io.exitCode).toBeNull();
  });

  it('prints JSON when --json is set', async () => {
    const { program, io } = buildHarness();

    await program.parseAsync(['node', 'freesolo', 'worktrees', 'list', '--json']);

    expect(JSON.parse(io.stdout.join(''))).toEqual(sampleRows);
  });

  it('sets exit code 2 on operational error', async () => {
    const { io, deps } = buildHarness({
      getWorktreeStore: vi.fn(() => {
        throw new StateStoreError('open-failed', 'disk full');
      })
    });

    await listAction({}, deps);

    expect(io.stderr.join('')).toContain('disk full');
    expect(io.exitCode).toBe(2);
  });
});

describe('freesolo worktrees drift', () => {
  it('exits 0 when no drift is found', async () => {
    const { program, io } = buildHarness();

    await program.parseAsync(['node', 'freesolo', 'worktrees', 'drift']);

    expect(io.stdout.join('')).toContain('No worktree metadata drift detected');
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when drift is found', async () => {
    const { program, io } = buildHarness({
      listWorktreeEntries: vi.fn().mockResolvedValue([
        { worktreePath: '/repo/.worktrees/wt-new', branchName: 'issue/99' }
      ])
    });

    await program.parseAsync(['node', 'freesolo', 'worktrees', 'drift']);

    expect(io.stdout.join('')).toContain('On disk only');
    expect(io.exitCode).toBe(1);
  });

  it('prints JSON when --json is set', async () => {
    const { program, io } = buildHarness({
      listWorktreeEntries: vi.fn().mockResolvedValue([
        { worktreePath: '/repo/.worktrees/wt-new', branchName: 'issue/99' }
      ])
    });

    await program.parseAsync(['node', 'freesolo', 'worktrees', 'drift', '--json']);

    const report = JSON.parse(io.stdout.join(''));
    expect(report.onDiskOnly).toHaveLength(1);
  });

  it('sets exit code 2 on operational error', async () => {
    const { io, deps } = buildHarness({
      resolveRepoRoot: vi.fn().mockRejectedValue(new Error('not a git repo'))
    });

    await driftAction({}, deps);

    expect(io.stderr.join('')).toContain('not a git repo');
    expect(io.exitCode).toBe(2);
  });

  it('reports metadata-only drift when stale DB paths are missing on disk', async () => {
    const { io, deps } = buildHarness({
      listWorktreeEntries: vi.fn().mockResolvedValue([]),
      getWorktreeStore: vi.fn().mockReturnValue({
        list: vi.fn().mockReturnValue([
          {
            id: 2,
            path: '/stale/deleted-wt',
            branch: 'issue/99',
            agentOwner: null,
            issueId: 99,
            createdAt: 't',
            lastSeenAt: 't'
          }
        ])
      }),
      pathExists: vi.fn(async () => false)
    });

    await driftAction({}, deps);

    expect(io.stdout.join('')).toContain('Metadata only (missing on disk)');
    expect(io.exitCode).toBe(1);
  });

  it('excludes rows from other repos when path still exists', async () => {
    const { io, deps } = buildHarness({
      getWorktreeStore: vi.fn().mockReturnValue({
        list: vi.fn().mockReturnValue([
          ...sampleRows,
          {
            id: 2,
            path: '/other/repo/wt',
            branch: 'issue/9',
            agentOwner: null,
            issueId: 9,
            createdAt: 't',
            lastSeenAt: 't'
          }
        ])
      }),
      pathExists: vi.fn(async () => true)
    });

    await driftAction({}, deps);

    expect(io.stdout.join('')).toContain('No worktree metadata drift detected');
    expect(io.exitCode).toBeNull();
  });
});
