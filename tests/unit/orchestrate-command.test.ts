import { describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import {
  registerOrchestrateCommands,
  type OrchestrateCommandDeps
} from '../../src/commands/orchestrate.js';
import type { WorkflowState } from '../../src/workflow/state-machine.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface HarnessOptions {
  initialState: WorkflowState | null;
  /** Maps a step (args joined with spaces) to exit code and optional state mutation. */
  onStep?: (step: string, setState: (state: WorkflowState) => void) => number;
}

function buildHarness(options: HarnessOptions) {
  let state = options.initialState;
  const setState = (next: WorkflowState): void => {
    state = next;
  };
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const steps: string[] = [];

  const deps: OrchestrateCommandDeps = {
    resolveRepoRoot: vi.fn().mockResolvedValue('/repo'),
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    resolveIssueNumber: vi.fn().mockImplementation(async (_root, override) => override ?? 24),
    readState: vi.fn().mockImplementation(async () => state),
    initializeState: vi.fn().mockImplementation(async () => {
      state = 'triaged';
    }),
    runStep: vi.fn().mockImplementation(async (args: string[]) => {
      const step = args.join(' ');
      steps.push(step);
      return options.onStep?.(step, setState) ?? 0;
    }),
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    }
  };

  const program = new Command();
  program.exitOverride();
  const plan = program.command('plan');
  registerOrchestrateCommands(plan, deps);
  return { program, io, deps, steps };
}

describe('freesolo plan (auto)', () => {
  it('initialises, generates, shows, and approves for a fresh issue', async () => {
    const { program, io, steps, deps } = buildHarness({
      initialState: null,
      onStep: (step, setState) => {
        if (step === 'plan generate --issue 24') {
          setState('planned');
        }
        return 0;
      }
    });

    await program.parseAsync(['node', 'freesolo', 'plan', '24']);

    expect(deps.initializeState).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, 24, 'triaged');
    expect(steps).toEqual([
      'plan generate --issue 24',
      'plan show --issue 24',
      'plan approve --issue 24'
    ]);
    expect(io.stdout.join('')).toContain('next: freesolo work 24');
    expect(io.exitCode).toBeNull();
  });

  it('skips generate when the plan was auto-approved', async () => {
    const { program, io, steps } = buildHarness({
      initialState: 'triaged',
      onStep: (step, setState) => {
        if (step === 'plan generate --issue 24') {
          setState('approved');
        }
        return 0;
      }
    });

    await program.parseAsync(['node', 'freesolo', 'plan', '24']);

    expect(steps).toEqual(['plan generate --issue 24']);
    expect(io.stdout.join('')).toContain('next: freesolo work 24');
  });

  it('propagates a failing generate step', async () => {
    const { program, io, steps } = buildHarness({
      initialState: 'triaged',
      onStep: () => 1
    });

    await program.parseAsync(['node', 'freesolo', 'plan', '24']);

    expect(steps).toEqual(['plan generate --issue 24']);
    expect(io.exitCode).toBe(1);
  });

  it('reports issues that are already past planning', async () => {
    const { program, io, steps } = buildHarness({ initialState: 'implementing' });

    await program.parseAsync(['node', 'freesolo', 'plan', '24']);

    expect(steps).toEqual([]);
    expect(io.stdout.join('')).toContain('already "implementing"');
  });
});
