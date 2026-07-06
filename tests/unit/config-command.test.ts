import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import { registerConfigCommands, type ConfigCommandDeps } from '../../src/commands/config.js';
import { DEFAULT_CONFIG } from '../../src/config/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: ConfigCommandDeps;
}

function buildHarness(overrides: Partial<ConfigCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: ConfigCommandDeps = {
    loadConfigWithOrigins: vi.fn().mockResolvedValue({
      config: structuredClone(DEFAULT_CONFIG),
      origins: {
        autonomous_mode: 'default',
        'watcher.interval_seconds': 'default',
        'watcher.source': 'default',
        'watcher.intake_mode': 'default',
        'watcher.initial_state': 'default',
        'watcher.trigger_label': 'default'
      }
    }),
    setConfigKey: vi.fn().mockResolvedValue(undefined),
    initConfigFile: vi.fn().mockResolvedValue(undefined),
    tryResolveRepoRoot: vi.fn().mockResolvedValue('/repo/root'),
    globalConfigPath: () => '/home/user/.freesolo/config.yaml',
    repoConfigPath: (root: string) => `${root}/.freesolo/config.yaml`,
    write: (msg) => io.stdout.push(msg),
    writeError: (msg) => io.stderr.push(msg),
    setExitCode: (code) => { io.exitCode = code; },
    ...overrides
  };
  const program = new Command();
  program.exitOverride();
  registerConfigCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config get', () => {
  it('prints the resolved value for a valid key', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'get', 'autonomous_mode'], { from: 'user' });
    expect(io.stdout.join('')).toContain('false');
  });

  it('sets exit code 1 and prints error for unknown key', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'get', 'unknown_key'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/unknown key/i);
  });
});

describe('config set', () => {
  it('calls setConfigKey with the global path by default', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'set', 'autonomous_mode', 'true'], { from: 'user' });
    expect(deps.setConfigKey).toHaveBeenCalledWith(
      '/home/user/.freesolo/config.yaml',
      'autonomous_mode',
      'true'
    );
  });

  it('calls setConfigKey with the repo path when --repo is given', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'set', 'autonomous_mode', 'true', '--repo'], { from: 'user' });
    expect(deps.setConfigKey).toHaveBeenCalledWith(
      '/repo/root/.freesolo/config.yaml',
      'autonomous_mode',
      'true'
    );
  });

  it('sets exit code 1 for an invalid value', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'set', 'autonomous_mode', 'badvalue'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/invalid value/i);
  });

  it('sets exit code 1 for --repo when not in a git repo', async () => {
    const { program, io } = buildHarness({
      tryResolveRepoRoot: vi.fn().mockResolvedValue(null)
    });
    await program.parseAsync(['config', 'set', 'autonomous_mode', 'true', '--repo'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/not inside a git repo/i);
  });

  it('sets exit code 1 for an unknown key', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'set', 'bad_key', 'value'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/unknown key/i);
  });

  it('sets exit code 1 for interval_seconds with trailing non-numeric characters', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'set', 'watcher.interval_seconds', '5abc'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/invalid value/i);
  });

  it('sets watcher source', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'set', 'watcher.source', 'label'], { from: 'user' });
    expect(deps.setConfigKey).toHaveBeenCalledWith(
      '/home/user/.freesolo/config.yaml',
      'watcher.source',
      'label'
    );
  });

  it('rejects invalid watcher source', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'set', 'watcher.source', 'mine'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/watcher.source/);
  });
});

describe('config show', () => {
  it('prints all four keys with their origins', async () => {
    const { program, io } = buildHarness({
      loadConfigWithOrigins: vi.fn().mockResolvedValue({
        config: structuredClone(DEFAULT_CONFIG),
        origins: {
          autonomous_mode: 'global',
          'watcher.interval_seconds': 'repo',
          'watcher.source': 'default',
          'watcher.intake_mode': 'default',
          'watcher.initial_state': 'default',
          'watcher.trigger_label': 'default'
        }
      })
    });
    await program.parseAsync(['config', 'show'], { from: 'user' });
    const out = io.stdout.join('');
    expect(out).toContain('autonomous_mode');
    expect(out).toContain('[global]');
    expect(out).toContain('watcher.interval_seconds');
    expect(out).toContain('[repo]');
    expect(out).toContain('[default]');
  });

  it('prints new watcher keys in config show', async () => {
    const { program, io } = buildHarness();
    await program.parseAsync(['config', 'show'], { from: 'user' });
    const out = io.stdout.join('');
    expect(out).toContain('watcher.source');
    expect(out).toContain('watcher.intake_mode');
    expect(out).toContain('watcher.initial_state');
  });
});

describe('config init', () => {
  it('calls initConfigFile with the global path by default', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'init'], { from: 'user' });
    expect(deps.initConfigFile).toHaveBeenCalledWith('/home/user/.freesolo/config.yaml');
  });

  it('calls initConfigFile with the repo path when --repo is given', async () => {
    const { program, deps } = buildHarness();
    await program.parseAsync(['config', 'init', '--repo'], { from: 'user' });
    expect(deps.initConfigFile).toHaveBeenCalledWith('/repo/root/.freesolo/config.yaml');
  });

  it('sets exit code 1 for --repo when not in a git repo', async () => {
    const { program, io } = buildHarness({
      tryResolveRepoRoot: vi.fn().mockResolvedValue(null)
    });
    await program.parseAsync(['config', 'init', '--repo'], { from: 'user' });
    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toMatch(/not inside a git repo/i);
  });
});
