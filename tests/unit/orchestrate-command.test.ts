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

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: OrchestrateCommandDeps;
  steps: string[];
}

interface HarnessOptions {
  initialState: WorkflowState | null;
  /** Maps a step (args joined with spaces) to exit code and optional state mutation. */
  onStep?: (step: string, setState: (state: WorkflowState) => void) => number;
  /** Called on each sleep; may advance state to simulate agents working. */
  onSleep?: (setState: (state: WorkflowState) => void) => void;
}

function buildHarness(options: HarnessOptions): Harness {
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
    currentBranch: vi.fn().mockResolvedValue('issue/24-widget-fix'),
    sleep: vi.fn().mockImplementation(async () => {
      options.onSleep?.(setState);
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
  registerOrchestrateCommands(program, plan, deps);
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

describe('freesolo work', () => {
  it('refuses unplanned issues with exit 2', async () => {
    const { program, io, steps } = buildHarness({ initialState: 'planned' });

    await program.parseAsync(['node', 'freesolo', 'work', '24']);

    expect(steps).toEqual([]);
    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('freesolo plan 24');
  });

  it('drives approved → team → verify → gate → PR → merge readiness', async () => {
    const { program, io, steps } = buildHarness({
      initialState: 'approved',
      onStep: (step, setState) => {
        if (step === 'team start --issue 24') {
          setState('implementing');
          return 0;
        }
        if (step === 'gate evaluate --issue 24') {
          setState('pr-ready');
          return 0;
        }
        if (step === 'candidate show --issue 24' || step === 'pr show --issue 24') {
          return 2; // no record yet
        }
        return 0;
      },
      onSleep: (setState) => {
        setState('verifying'); // agents finish implementation + review
      }
    });

    await program.parseAsync(['node', 'freesolo', 'work', '24']);

    expect(steps).toEqual([
      'team start --issue 24',
      'verify --issue 24',
      'gate evaluate --issue 24',
      'candidate show --issue 24',
      'candidate create --issue 24 --team issue-24 --branches issue/24-widget-fix',
      'pr show --issue 24',
      'pr create --issue 24',
      'merge evaluate --issue 24'
    ]);
    expect(io.stdout.join('')).toContain('PR is ready to merge');
    expect(io.exitCode).toBeNull();
  });

  it('merges and closes with --merge', async () => {
    const { program, io, steps } = buildHarness({
      initialState: 'pr-ready',
      onStep: (step, setState) => {
        if (step === 'merge --issue 24') {
          setState('merged');
          return 0;
        }
        if (step === 'engine tick --issue 24') {
          setState('closed');
          return 0;
        }
        return 0; // candidate/pr records exist, readiness green
      }
    });

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--merge']);

    expect(steps).toEqual([
      'candidate show --issue 24',
      'pr show --issue 24',
      'merge evaluate --issue 24',
      'merge --issue 24',
      'engine tick --issue 24'
    ]);
    expect(io.stdout.join('')).toContain('closed — done');
    expect(io.exitCode).toBeNull();
  });

  it('keeps polling while merge readiness is red, without re-creating the PR', async () => {
    let readinessCalls = 0;
    const { program, steps } = buildHarness({
      initialState: 'pr-ready',
      onStep: (step, setState) => {
        if (step === 'merge evaluate --issue 24') {
          readinessCalls += 1;
          if (readinessCalls < 3) {
            return 1; // CI/bots still red
          }
          return 0;
        }
        if (step === 'merge --issue 24') {
          setState('merged');
        }
        if (step === 'engine tick --issue 24') {
          setState('closed');
        }
        return 0;
      }
    });

    await program.parseAsync(['node', 'freesolo', 'work', '24', '--merge']);

    expect(steps.filter((step) => step === 'merge evaluate --issue 24')).toHaveLength(3);
    expect(steps.filter((step) => step === 'candidate show --issue 24')).toHaveLength(1);
    expect(steps.filter((step) => step === 'pr show --issue 24')).toHaveLength(1);
  });

  it('propagates a gate error (exit > 1) instead of looping', async () => {
    const { program, io } = buildHarness({
      initialState: 'verifying',
      onStep: (step) => (step === 'gate evaluate --issue 24' ? 2 : 0)
    });

    await program.parseAsync(['node', 'freesolo', 'work', '24']);

    expect(io.exitCode).toBe(2);
  });
});
