import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import {
  registerDecompositionCommands,
  type DecompositionCommandDeps
} from '../../src/commands/decomposition.js';
import { IssueIdError } from '../../src/core/issue-id.js';
import { ChildIssueCreationError, createChildIssues } from '../../src/github/issues.js';
import {
  DecompositionAlreadyAppliedError,
  DecompositionNotFoundError,
  DecompositionValidationError,
  readDecomposition,
  readDecompositionApplied,
  writeDecomposition,
  writeDecompositionApplied
} from '../../src/planner/decomposition-store.js';
import type { DecompositionPlan } from '../../src/planner/schemas/decomposition-plan.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const plan: DecompositionPlan = {
  parent_issue: 37,
  children: [{ title: 'Backend', body: '## Parent\n\n#37\n\nAPI', labels: ['state:triaged'] }]
};

const issue = { number: 37, title: 'Automatic Issue Decomposition', body: 'Big epic' };

const worktrees: string[] = [];

async function makeWorktree(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-decomp-cmd-'));
  worktrees.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function buildHarness(
  worktreePath: string,
  overrides: Partial<DecompositionCommandDeps> = {}
): {
  program: Command;
  io: CapturedIo;
  deps: DecompositionCommandDeps;
} {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: DecompositionCommandDeps = {
    resolveRepoRoot: vi.fn().mockResolvedValue(worktreePath),
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    resolveIssueNumber: vi.fn().mockResolvedValue(37),
    runIssueDecomposer: vi.fn().mockResolvedValue({
      plan,
      decompositionPath: '/repo/.git/issueflow/decomposition.json'
    }),
    createDecompositionAgent: vi.fn().mockReturnValue({}),
    fetchIssue: vi.fn().mockResolvedValue(issue),
    readDecomposition,
    writeDecomposition,
    getDecompositionPath: vi.fn().mockImplementation(async () => {
      const { getDecompositionPath } = await import('../../src/planner/decomposition-store.js');
      return getDecompositionPath(worktreePath);
    }),
    readDecompositionApplied,
    writeDecompositionApplied,
    createChildIssues: vi.fn().mockResolvedValue([
      { number: 101, title: 'Backend', url: 'https://github.com/acme/widgets/issues/101' }
    ]),
    openEditor: vi.fn().mockResolvedValue(0),
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
  registerDecompositionCommands(program, deps);
  return { program, io, deps };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(worktrees.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('issueflow decomposition show', () => {
  it('prints pretty JSON when a decomposition preview exists', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'show', '--issue', '37']);

    expect(JSON.parse(io.stdout.join(''))).toEqual(plan);
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when the decomposition preview is missing', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readDecomposition: vi.fn().mockRejectedValue(new DecompositionNotFoundError('/missing'))
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'show', '--issue', '37']);

    expect(io.stderr.join('')).toContain('decomposition preview not found');
    expect(io.exitCode).toBe(1);
  });

  it('exits 2 when no issue can be resolved', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      resolveIssueNumber: vi.fn().mockRejectedValue(new IssueIdError('no issue'))
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'show']);

    expect(io.stderr.join('')).toContain('no issue');
    expect(io.exitCode).toBe(2);
  });
});

describe('issueflow decomposition generate', () => {
  it('requires ISSUEFLOW_ENGINE=1', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, { env: {} });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'generate', '--issue', '37']);

    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE=1');
    expect(io.exitCode).toBe(3);
  });

  it('writes a decomposition preview on success', async () => {
    const worktreePath = await makeWorktree();
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'generate', '--issue', '37']);

    expect(deps.runIssueDecomposer).toHaveBeenCalled();
    expect(io.stdout.join('')).toContain('decomposition preview written:');
    expect(io.exitCode).toBeNull();
  });

  it('rejects when decomposition has already been applied', async () => {
    const worktreePath = await makeWorktree();
    await writeDecompositionApplied(worktreePath, {
      parent_issue: 37,
      applied_at: '2026-06-08T00:00:00.000Z',
      children: [{ number: 101, title: 'Backend', url: 'https://github.com/acme/widgets/issues/101' }]
    });
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'generate', '--issue', '37']);

    expect(io.stderr.join('')).toContain('already been applied');
    expect(io.exitCode).toBe(1);
  });

  it('rejects when preview exists without --force', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'generate', '--issue', '37']);

    expect(io.stderr.join('')).toContain('--force');
    expect(io.exitCode).toBe(1);
  });

  it('overwrites preview with --force when not applied', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync([
      'node',
      'issueflow',
      'decomposition',
      'generate',
      '--issue',
      '37',
      '--force'
    ]);

    expect(deps.runIssueDecomposer).toHaveBeenCalled();
    expect(io.stdout.join('')).toContain('decomposition preview written:');
    expect(io.exitCode).toBeNull();
  });

  it('rejects --force when decomposition has already been applied', async () => {
    const worktreePath = await makeWorktree();
    await writeDecompositionApplied(worktreePath, {
      parent_issue: 37,
      applied_at: '2026-06-08T00:00:00.000Z',
      children: [{ number: 101, title: 'Backend', url: 'https://github.com/acme/widgets/issues/101' }]
    });
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync([
      'node',
      'issueflow',
      'decomposition',
      'generate',
      '--issue',
      '37',
      '--force'
    ]);

    expect(io.stderr.join('')).toContain('already been applied');
    expect(io.exitCode).toBe(1);
  });
});

describe('issueflow decomposition edit', () => {
  it('writes validated editor output back to decomposition.json', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const updated: DecompositionPlan = {
      parent_issue: 37,
      children: [{ title: 'Frontend', body: '## Parent\n\n#37\n\nUI', labels: [] }]
    };
    const { program, io, deps } = buildHarness(worktreePath, {
      openEditor: vi.fn().mockImplementation(async (filePath: string) => {
        await fs.writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`);
        return 0;
      })
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'edit', '--issue', '37']);

    expect(deps.openEditor).toHaveBeenCalled();
    expect(await readDecomposition(worktreePath)).toEqual(updated);
    expect(io.stdout.join('')).toContain('decomposition preview updated');
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when decomposition preview file is missing', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'edit', '--issue', '37']);

    expect(io.stderr.join('')).toContain('decomposition preview not found');
    expect(io.exitCode).toBe(1);
  });

  it('does not write back when parent_issue mismatches resolved issue', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io } = buildHarness(worktreePath, {
      openEditor: vi.fn().mockImplementation(async (filePath: string) => {
        await fs.writeFile(
          filePath,
          JSON.stringify({ parent_issue: 99, children: plan.children })
        );
        return 0;
      })
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'edit', '--issue', '37']);

    expect(await readDecomposition(worktreePath)).toEqual(plan);
    expect(io.stderr.join('')).toContain('does not match issue #37');
    expect(io.exitCode).toBe(1);
  });

  it('does not write back when editor output fails validation', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io } = buildHarness(worktreePath, {
      openEditor: vi.fn().mockImplementation(async (filePath: string) => {
        await fs.writeFile(filePath, JSON.stringify({ parent_issue: 37, children: [] }));
        return 0;
      })
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'edit', '--issue', '37']);

    expect(await readDecomposition(worktreePath)).toEqual(plan);
    expect(io.stderr.join('')).toMatch(/children/i);
    expect(io.exitCode).toBe(1);
  });
});

describe('issueflow decomposition approve', () => {
  it('requires ISSUEFLOW_ENGINE=1', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, { env: {} });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE=1');
    expect(io.exitCode).toBe(3);
  });

  it('creates child issues and writes applied record', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(deps.createChildIssues).toHaveBeenCalledWith({
      repo: { owner: 'acme', repo: 'widgets' },
      parentIssue: 37,
      children: plan.children
    });
    const applied = await readDecompositionApplied(worktreePath);
    expect(applied?.children).toHaveLength(1);
    expect(io.stdout.join('')).toContain('#101 Backend');
    expect(io.exitCode).toBeNull();
  });

  it('is idempotent when applied record already exists', async () => {
    const worktreePath = await makeWorktree();
    await writeDecompositionApplied(worktreePath, {
      parent_issue: 37,
      applied_at: '2026-06-08T00:00:00.000Z',
      children: [{ number: 101, title: 'Backend', url: 'https://github.com/acme/widgets/issues/101' }]
    });
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(deps.createChildIssues).not.toHaveBeenCalled();
    expect(io.stdout.join('')).toBe(
      '#101 Backend https://github.com/acme/widgets/issues/101\n'
    );
    expect(io.exitCode).toBeNull();
  });

  it('succeeds with ISSUEFLOW_AUTONOMOUS=1 and ISSUEFLOW_ENGINE=1', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io } = buildHarness(worktreePath, {
      env: { ISSUEFLOW_ENGINE: '1', ISSUEFLOW_AUTONOMOUS: '1' }
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(io.stdout.join('')).toContain('#101 Backend');
    expect(io.exitCode).toBeNull();
  });

  it('exits 1 when decomposition validation fails', async () => {
    const worktreePath = await makeWorktree();
    const { program, io } = buildHarness(worktreePath, {
      readDecomposition: vi.fn().mockRejectedValue(new DecompositionValidationError('invalid'))
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(io.stderr.join('')).toContain('invalid');
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 when preview parent_issue mismatches resolved issue', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, {
      parent_issue: 99,
      children: plan.children
    });
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(deps.createChildIssues).not.toHaveBeenCalled();
    expect(io.stderr.join('')).toContain('does not match issue #37');
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 when applied record parent_issue mismatches resolved issue', async () => {
    const worktreePath = await makeWorktree();
    await writeDecompositionApplied(worktreePath, {
      parent_issue: 99,
      applied_at: '2026-06-08T00:00:00.000Z',
      children: [{ number: 101, title: 'Backend', url: 'https://github.com/acme/widgets/issues/101' }]
    });
    const { program, io, deps } = buildHarness(worktreePath);

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(deps.createChildIssues).not.toHaveBeenCalled();
    expect(io.stderr.join('')).toContain('does not match issue #37');
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 when child issue creation fails without writing applied record', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, plan);
    const { program, io } = buildHarness(worktreePath, {
      createChildIssues: vi
        .fn()
        .mockRejectedValue(new ChildIssueCreationError(0, 'gh: validation failed'))
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(await readDecompositionApplied(worktreePath)).toBeNull();
    expect(io.stderr.join('')).toContain('failed to create child issue');
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 when child body references the wrong parent', async () => {
    const worktreePath = await makeWorktree();
    await writeDecomposition(worktreePath, {
      parent_issue: 37,
      children: [{ title: 'Bad', body: '## Parent\n\n#99\n\nWork', labels: [] }]
    });
    const { program, io } = buildHarness(worktreePath, {
      createChildIssues
    });

    await program.parseAsync(['node', 'issueflow', 'decomposition', 'approve', '--issue', '37']);

    expect(await readDecompositionApplied(worktreePath)).toBeNull();
    expect(io.stderr.join('')).toContain('references parent #99');
    expect(io.exitCode).toBe(1);
  });
});
