import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { registerPlanCommands, type PlanCommandDeps } from '../../src/commands/plan.js';
import { IssueIdError } from '../../src/core/issue-id.js';
import {
  getTeamPlanPath,
  readTeamPlan,
  TeamPlanNotFoundError,
  TeamPlanValidationError,
  writeTeamPlan
} from '../../src/planner/store.js';
import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';
import { maybeAutoApproveTeamPlan as realMaybeAutoApproveTeamPlan } from '../../src/policy/autonomous-approval.js';
import {
  InvalidStateLabelError,
  MultipleStateLabelsError
} from '../../src/workflow/state-store.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const definition: TeamDefinition = {
  roles: [{ name: 'Engineer', host: 'cursor', responsibility: 'Ship feature', count: 1 }]
};

const issue = { number: 34, title: 'Team Planner', body: 'Build it' };

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-plan-cmd-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function buildHarness(
  worktreePath: string,
  overrides: Partial<PlanCommandDeps> = {}
): {
  program: Command;
  io: CapturedIo;
  deps: PlanCommandDeps;
} {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: PlanCommandDeps = {
    resolveRepoRoot: vi.fn().mockResolvedValue(worktreePath),
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    resolveIssueNumber: vi.fn().mockResolvedValue(34),
    readState: vi.fn().mockResolvedValue('triaged'),
    writeState: vi.fn().mockResolvedValue(undefined),
    runTeamPlanner: vi.fn().mockResolvedValue({
      definition,
      teamPlanPath: '/repo/.git/issueflow/team-plan.json'
    }),
    createPlannerAgent: vi.fn().mockReturnValue({}),
    fetchIssue: vi.fn().mockResolvedValue(issue),
    readTeamPlan,
    writeTeamPlan,
    getTeamPlanPath,
    openEditor: vi.fn().mockResolvedValue(0),
    maybeAutoApproveTeamPlan: vi.fn().mockResolvedValue({ status: 'skipped' }),
    appendEvent: vi.fn(),
    env: { ISSUEFLOW_ENGINE: '1' },
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
  registerPlanCommands(program, deps);
  return { program, io, deps };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('issueflow plan show', () => {
  it('prints pretty JSON when a team plan exists', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'plan', 'show', '--issue', '34']);

    expect(JSON.parse(io.stdout.join(''))).toEqual(definition);
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when the team plan is missing', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readTeamPlan: vi.fn().mockRejectedValue(new TeamPlanNotFoundError('/missing'))
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'show', '--issue', '34']);

    expect(io.stderr.join('')).toContain('team plan not found');
    expect(io.exitCode).toBe(1);
  });

  it('exits 2 when no issue can be resolved', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      resolveIssueNumber: vi.fn().mockRejectedValue(new IssueIdError('no issue'))
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'show']);

    expect(io.stderr.join('')).toContain('no issue');
    expect(io.exitCode).toBe(2);
  });
});

describe('issueflow plan generate', () => {
  it('requires ISSUEFLOW_ENGINE=1', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, { env: {} });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE=1');
    expect(io.exitCode).toBe(3);
  });

  it('transitions triaged to planned on success', async () => {
    const worktreePath = await makeWorktree();
    const { program, io, deps } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged')
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(deps.runTeamPlanner).toHaveBeenCalled();
    expect(deps.writeState).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets' },
      34,
      'triaged',
      'planned'
    );
    expect(io.stdout.join('')).toContain('team plan written:');
    expect(io.exitCode).toBeNull();
  });

  it('rejects when current state is not triaged', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('planned')
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(io.stderr.join('')).toContain('triaged');
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 when the issue has no workflow state', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(io.stderr.join('')).toContain('no current workflow state');
    expect(io.exitCode).toBe(1);
  });

  it('exits 4 on malformed state labels', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockRejectedValue(new MultipleStateLabelsError(34, ['triaged', 'planned']))
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(io.stderr.join('')).toContain('multiple workflow state labels');
    expect(io.exitCode).toBe(4);
  });

  it('does not print autonomous line when policy skips', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged'),
      maybeAutoApproveTeamPlan: vi.fn().mockResolvedValue({ status: 'skipped' })
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(io.stdout.join('')).toContain('team plan written:');
    expect(io.stdout.join('')).not.toContain('autonomous');
  });

  it('prints autonomous approval line when policy approves', async () => {
    const worktreePath = await makeWorktree();
    const { program, io, deps } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged'),
      maybeAutoApproveTeamPlan: vi.fn().mockResolvedValue({
        status: 'approved',
        teamPlanPath: '/repo/.git/issueflow/team-plan.json'
      })
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(deps.maybeAutoApproveTeamPlan).toHaveBeenCalled();
    expect(io.stdout.join('')).toContain('planned -> approved (autonomous)');
  });

  it('exits 1 when auto-approve policy throws', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged'),
      maybeAutoApproveTeamPlan: vi.fn().mockRejectedValue(new Error('auto-approve failed'))
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(io.stderr.join('')).toContain('auto-approve failed');
    expect(io.exitCode).toBe(1);
  });

  it('calls writeState twice and appendEvent when autonomous mode is enabled', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    const appendEvent = vi.fn();
    const writeState = vi.fn().mockResolvedValue(undefined);
    const teamPlanPath = await getTeamPlanPath(worktreePath);

    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged'),
      writeState,
      appendEvent,
      maybeAutoApproveTeamPlan: (input, nestedDeps) =>
        realMaybeAutoApproveTeamPlan(input, {
          resolveAutonomousMode: vi.fn().mockResolvedValue(true),
          readTeamPlan: (wt) => readTeamPlan(wt),
          writeState,
          appendEvent
        }),
      runTeamPlanner: vi.fn().mockResolvedValue({ definition, teamPlanPath })
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'generate', '--issue', '34']);

    expect(writeState).toHaveBeenCalledTimes(2);
    expect(writeState).toHaveBeenNthCalledWith(
      1,
      { owner: 'acme', repo: 'widgets' },
      34,
      'triaged',
      'planned'
    );
    expect(writeState).toHaveBeenNthCalledWith(
      2,
      { owner: 'acme', repo: 'widgets' },
      34,
      'planned',
      'approved'
    );
    expect(appendEvent).toHaveBeenCalledWith({
      eventType: 'team.planned',
      issueId: 34,
      payload: { teamPlanPath, autonomous: true }
    });
    expect(io.stdout.join('')).toContain('planned -> approved (autonomous)');
  });
});

describe('issueflow plan edit', () => {
  it('writes validated editor output back to team-plan.json', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    const updated: TeamDefinition = {
      roles: [{ name: 'Reviewer', host: 'claude', responsibility: 'Review PR', count: 1 }]
    };
    const { program, io, deps } = buildHarness(worktreePath, {
      openEditor: vi.fn().mockImplementation(async (filePath: string) => {
        await fs.writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);
        return 0;
      })
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'edit', '--issue', '34']);

    expect(deps.openEditor).toHaveBeenCalled();
    expect(await readTeamPlan(worktreePath)).toEqual(updated);
    expect(io.stdout.join('')).toContain('team plan updated');
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when team plan file is missing', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'plan', 'edit', '--issue', '34']);

    expect(io.stderr.join('')).toContain('team plan not found');
    expect(io.exitCode).toBe(1);
  });

  it('does not write back when editor output fails validation', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    const { program, io } = buildHarness(worktreePath, {
      openEditor: vi.fn().mockImplementation(async (filePath: string) => {
        await fs.writeFile(filePath, JSON.stringify({ roles: [] }));
        return 0;
      })
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'edit', '--issue', '34']);

    expect(await readTeamPlan(worktreePath)).toEqual(definition);
    expect(io.stderr.join('')).toMatch(/roles/i);
    expect(io.exitCode).toBe(1);
  });
});

describe('issueflow plan approve', () => {
  it('requires ISSUEFLOW_ENGINE=1', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, { env: {} });

    await program.parseAsync(['node', 'issueflow', 'plan', 'approve', '--issue', '34']);

    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE=1');
    expect(io.exitCode).toBe(3);
  });

  it('validates and transitions planned to approved', async () => {
    const worktreePath = await makeWorktree();
    await writeTeamPlan(worktreePath, definition);
    const { program, io, deps } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('planned')
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'approve', '--issue', '34']);

    expect(deps.writeState).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets' },
      34,
      'planned',
      'approved'
    );
    expect(io.stdout.join('')).toBe('planned -> approved\n');
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when current state is not planned', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('triaged')
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'approve', '--issue', '34']);

    expect(io.stderr.join('')).toContain('planned');
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 when team plan validation fails', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockResolvedValue('planned'),
      readTeamPlan: vi.fn().mockRejectedValue(new TeamPlanValidationError('invalid'))
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'approve', '--issue', '34']);

    expect(io.stderr.join('')).toContain('invalid');
    expect(io.exitCode).toBe(1);
  });

  it('exits 4 on malformed state labels', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readState: vi.fn().mockRejectedValue(new InvalidStateLabelError(34, ['state:bogus']))
    });

    await program.parseAsync(['node', 'issueflow', 'plan', 'approve', '--issue', '34']);

    expect(io.stderr.join('')).toContain('unrecognised workflow state label');
    expect(io.exitCode).toBe(4);
  });
});
