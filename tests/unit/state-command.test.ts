import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { registerStateCommands, type StateCommandDeps } from '../../src/commands/state.js';
import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import { MultipleStateLabelsError } from '../../src/workflow/state-store.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: StateCommandDeps;
}

function buildHarness(overrides: Partial<StateCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: StateCommandDeps = {
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    readState: vi.fn().mockResolvedValue('triaged'),
    writeState: vi.fn().mockResolvedValue(undefined),
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
  registerStateCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('issueflow state get', () => {
  it('prints the current state when one exists', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockResolvedValue('implementing')
    });

    await program.parseAsync(['node', 'issueflow', 'state', 'get', '--issue', '17']);

    expect(deps.readState).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, 17);
    expect(io.stdout).toEqual(['implementing\n']);
    expect(io.exitCode).toBeNull();
  });

  it('does not require ISSUEFLOW_ENGINE for state get', async () => {
    const { program, io, deps } = buildHarness({
      env: {},
      readState: vi.fn().mockResolvedValue('implementing')
    });

    await program.parseAsync(['node', 'issueflow', 'state', 'get', '--issue', '17']);

    expect(deps.readState).toHaveBeenCalledWith({ owner: 'acme', repo: 'widgets' }, 17);
    expect(io.stdout).toEqual(['implementing\n']);
    expect(io.exitCode).toBeNull();
  });

  it('prints null and exits 2 when the issue has no state label', async () => {
    const { program, io } = buildHarness({
      readState: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync(['node', 'issueflow', 'state', 'get', '--issue', '17']);

    expect(io.stdout).toEqual(['null\n']);
    expect(io.exitCode).toBe(2);
  });

  it('reports a malformed state and exits 4', async () => {
    const { program, io } = buildHarness({
      readState: vi.fn().mockRejectedValue(new MultipleStateLabelsError(17, ['triaged', 'planned']))
    });

    await program.parseAsync(['node', 'issueflow', 'state', 'get', '--issue', '17']);

    expect(io.stdout).toEqual([]);
    expect(io.stderr.join('')).toContain('multiple workflow state labels');
    expect(io.exitCode).toBe(4);
  });
});

describe('issueflow state transition', () => {
  it('refuses to run without ISSUEFLOW_ENGINE and exits 3', async () => {
    const { program, io, deps } = buildHarness({ env: {} });

    await program.parseAsync([
      'node',
      'issueflow',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.readState).not.toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(3);
    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE');
  });

  it('reads the current state, validates, and writes the new state when gated', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockResolvedValue('triaged')
    });

    await program.parseAsync([
      'node',
      'issueflow',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.writeState).toHaveBeenCalledWith(
      { owner: 'acme', repo: 'widgets' },
      17,
      'triaged',
      'planned'
    );
    expect(io.stdout.join('')).toBe('triaged -> planned\n');
    expect(io.exitCode).toBeNull();
  });

  it('rejects --to values outside the known states with a clear error and exit 1', async () => {
    const { program, io, deps } = buildHarness();

    await program.parseAsync([
      'node',
      'issueflow',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'bogus'
    ]);

    expect(deps.readState).not.toHaveBeenCalled();
    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('Unknown state "bogus"');
  });

  it('refuses to transition from an uninitialised issue', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockResolvedValue(null)
    });

    await program.parseAsync([
      'node',
      'issueflow',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('has no current workflow state');
  });

  it('surfaces InvalidTransitionError with exit code 1', async () => {
    const writeState = vi.fn().mockRejectedValue(
      new InvalidTransitionError('triaged', 'merged', ['planned'])
    );
    const { program, io } = buildHarness({
      readState: vi.fn().mockResolvedValue('triaged'),
      writeState
    });

    await program.parseAsync([
      'node',
      'issueflow',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'merged'
    ]);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('Invalid workflow transition: triaged → merged');
  });

  it('exits 4 when readState sees multiple state labels during transition', async () => {
    const { program, io, deps } = buildHarness({
      readState: vi.fn().mockRejectedValue(new MultipleStateLabelsError(17, ['triaged', 'planned']))
    });

    await program.parseAsync([
      'node',
      'issueflow',
      'state',
      'transition',
      '--issue',
      '17',
      '--to',
      'planned'
    ]);

    expect(deps.writeState).not.toHaveBeenCalled();
    expect(io.stdout).toEqual([]);
    expect(io.exitCode).toBe(4);
    expect(io.stderr.join('')).toContain('multiple workflow state labels');
  });
});
