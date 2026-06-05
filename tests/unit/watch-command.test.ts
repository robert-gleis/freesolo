import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { registerWatchCommands, type WatchCommandDeps } from '../../src/commands/watch.js';
import { buildCli } from '../../src/cli.js';
import type { StateDb } from '../../src/state/db.js';
import type { WatchCycleResult } from '../../src/watcher/runner.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: WatchCommandDeps;
}

function cycleResult(overrides: Partial<WatchCycleResult> = {}): WatchCycleResult {
  return { enqueued: 0, processed: 0, failed: 0, rateLimited: false, ...overrides };
}

function buildHarness(overrides: Partial<WatchCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: WatchCommandDeps = {
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    loadConfig: vi.fn().mockResolvedValue({
      watcher: { interval_seconds: 60, trigger_label: 'state:triaged' }
    }),
    openStateDb: vi.fn().mockResolvedValue({ close: vi.fn() } as unknown as StateDb),
    runWatchCycle: vi.fn().mockResolvedValue(cycleResult()),
    runWatchLoop: vi.fn().mockResolvedValue(undefined),
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
  registerWatchCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('watch command registration', () => {
  it('registers watch run and watch once subcommands', () => {
    const program = buildCli();
    const names = program.commands.map((command) => command.name());
    expect(names).toContain('watch');

    const watch = program.commands.find((command) => command.name() === 'watch');
    expect(watch?.commands.map((command) => command.name())).toEqual(['run', 'once']);
  });
});

describe('watch run env gate', () => {
  it('refuses without ISSUEFLOW_ENGINE=1 and exits 3 without calling runner', async () => {
    const { program, io, deps } = buildHarness({ env: {} });

    await program.parseAsync(['node', 'issueflow', 'watch', 'run']);

    expect(deps.runWatchLoop).not.toHaveBeenCalled();
    expect(deps.runWatchCycle).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(3);
    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE');
  });
});

describe('watch once env gate', () => {
  it('runs without ISSUEFLOW_ENGINE gate', async () => {
    const { program, io, deps } = buildHarness({ env: {} });

    await program.parseAsync(['node', 'issueflow', 'watch', 'once']);

    expect(deps.runWatchCycle).toHaveBeenCalled();
    expect(io.exitCode).toBeNull();
  });
});

describe('watch exit codes', () => {
  it('sets exit code 1 when cycle reports failed > 0', async () => {
    const { program, io } = buildHarness({
      runWatchCycle: vi.fn().mockResolvedValue(cycleResult({ failed: 2 }))
    });

    await program.parseAsync(['node', 'issueflow', 'watch', 'once']);

    expect(io.exitCode).toBe(1);
  });

  it('sets exit code 1 on poll error for once', async () => {
    const { program, io } = buildHarness({
      runWatchCycle: vi.fn().mockResolvedValue(cycleResult({ pollError: 'HTTP 401: Bad credentials' }))
    });

    await program.parseAsync(['node', 'issueflow', 'watch', 'once']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('401');
  });
});

describe('watch run CLI overrides', () => {
  it('passes --interval and --trigger-label over config values', async () => {
    const { program, deps } = buildHarness();

    await program.parseAsync([
      'node',
      'issueflow',
      'watch',
      'run',
      '--interval',
      '120',
      '--trigger-label',
      'state:planned'
    ]);

    expect(deps.runWatchLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        intervalMs: 120_000,
        triggerLabel: 'state:planned'
      })
    );
  });
});
