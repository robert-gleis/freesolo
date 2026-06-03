import { describe, expect, it, vi } from 'vitest';

import { TmuxRunner } from '../../src/runners/tmux.js';

const SPAWN_POLL_TIMEOUT_MS = 2000;
import { RunnerError } from '../../src/runners/types.js';
import type { TmuxExecResult } from '../../src/runners/tmux-command.js';

function ok(stdout = ''): TmuxExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function fail(stderr = 'error'): TmuxExecResult {
  return { stdout: '', stderr, exitCode: 1 };
}

function monotonicNow() {
  let tick = 0;
  return () => new Date(1_700_000_000_000 + tick++ * 1000);
}

describe('TmuxRunner', () => {
  describe('initial state', () => {
    it('reports idle before spawn', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async () => ok()
      });

      expect((await runner.status()).state).toBe('idle');
      expect((await runner.logs()).stdout).toBe('');
    });
  });

  describe('spawn() — happy path', () => {
    it('transitions to running and issues new-session then send-keys', async () => {
      const calls: string[][] = [];
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          calls.push(args);
          if (args[0] === 'has-session') return ok();
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: ['--foo'], cwd: '/tmp' });

      expect((await runner.status()).state).toBe('running');
      expect(calls.some((c) => c[0] === 'new-session' && c.includes('issueflow-r1'))).toBe(true);
      expect(calls.some((c) => c[0] === 'send-keys' && c.includes('agent'))).toBe(true);
    });

    it('kills stale session before new-session', async () => {
      const calls: string[][] = [];
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          calls.push(args);
          if (args[0] === 'has-session' && calls.filter((c) => c[0] === 'has-session').length === 1) {
            return ok();
          }
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });

      const killIndex = calls.findIndex((c) => c[0] === 'kill-session');
      const newIndex = calls.findIndex((c) => c[0] === 'new-session');
      expect(killIndex).toBeGreaterThanOrEqual(0);
      expect(newIndex).toBeGreaterThan(killIndex);
    });

    it('records startedAt via injected now', async () => {
      const now = monotonicNow();
      const runner = new TmuxRunner('r1', {
        now,
        runTmux: async (args) => {
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      const status = await runner.status();

      expect(status.startedAt).toEqual(new Date(1_700_000_000_000));
    });

    it('uses -- before binary so send-keys does not treat -flags as options', async () => {
      const calls: string[][] = [];
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          calls.push(args);
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: '-l', args: ['--verbose'], cwd: '/tmp' });

      const sendKeys = calls.find((c) => c[0] === 'send-keys');
      expect(sendKeys).toEqual([
        'send-keys',
        '-t',
        'issueflow-r1',
        '--',
        '-l',
        '--verbose',
        'Enter'
      ]);
    });

    it('skips empty env entries for set-environment', async () => {
      const calls: string[][] = [];
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          calls.push(args);
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({
        binary: 'agent',
        args: [],
        cwd: '/tmp',
        env: { FOO: 'bar', EMPTY: '' }
      });

      const envCalls = calls.filter((c) => c[0] === 'set-environment');
      expect(envCalls).toHaveLength(1);
      expect(envCalls[0]).toContain('FOO');
      expect(envCalls[0]).not.toContain('EMPTY');
    });
  });

  describe('spawn() — failures', () => {
    it('rejects invalid-state when already running', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });

      await expect(
        runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' })
      ).rejects.toMatchObject({ code: 'invalid-state' });
      expect((await runner.status()).state).toBe('running');
    });

    it('rejects spawn-failed when tmux -V fails', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === '-V') return fail('not found');
          return ok();
        }
      });

      await expect(
        runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' })
      ).rejects.toMatchObject({ code: 'spawn-failed' });
      expect((await runner.status()).state).toBe('error');
    });

    it('rejects spawn-failed when new-session fails', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'new-session') return fail('dup');
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await expect(
        runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' })
      ).rejects.toMatchObject({ code: 'spawn-failed' });
      expect((await runner.status()).state).toBe('error');
    });

    it('rejects spawn-failed on poll timeout', async () => {
      vi.useFakeTimers();
      try {
        const runner = new TmuxRunner('r1', {
          runTmux: async (args) => {
            if (args[0] === 'has-session') return fail();
            if (args[0] === 'list-panes') return ok('1');
            return ok();
          }
        });

        const spawnPromise = runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
        const rejection = expect(spawnPromise).rejects.toMatchObject({ code: 'spawn-failed' });
        await vi.advanceTimersByTimeAsync(SPAWN_POLL_TIMEOUT_MS + 100);
        await rejection;
        expect((await runner.status()).state).toBe('error');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('stop() and logs()', () => {
    it('stops a running session', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'list-panes') return ok('0\n');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      await runner.stop();

      expect((await runner.status()).state).toBe('stopped');
    });

    it('returns capture-pane output with ScriptedRunner combined format', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'capture-pane') return ok('hello\n');
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      const snapshot = await runner.logs();

      expect(snapshot.stdout).toBe('hello\n');
      expect(snapshot.stderr).toBe('');
      expect(snapshot.truncated).toBe(false);
      expect(snapshot.combined).toBe('[stdout]\nhello\n');
    });

    it('records stoppedAt via injected now', async () => {
      const now = monotonicNow();
      const runner = new TmuxRunner('r1', {
        now,
        runTmux: async (args) => {
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      await runner.stop();
      const status = await runner.status();

      expect(status.stoppedAt).toEqual(new Date(1_700_000_001_000));
    });

    it('rejects stop-failed when kill-session fails', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'kill-session') return fail('permission denied');
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });

      await expect(runner.stop()).rejects.toMatchObject({ code: 'stop-failed' });
      expect((await runner.status()).state).toBe('error');
    });

    it('returns cached logs after session is gone', async () => {
      let captureCalls = 0;
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'capture-pane') {
            captureCalls += 1;
            if (captureCalls === 1) return ok('cached line\n');
            return fail();
          }
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      await runner.logs();
      await runner.stop();

      const snapshot = await runner.logs();
      expect(snapshot.stdout).toBe('cached line\n');
    });
  });

  describe('stop() — edge cases', () => {
    it('no-ops stop from idle', async () => {
      const runner = new TmuxRunner('r1', { runTmux: async () => ok() });
      await runner.stop();
      expect((await runner.status()).state).toBe('idle');
    });

    it('preserves error message when stopping from error state', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === '-V') return fail();
          return ok();
        }
      });

      await expect(
        runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' })
      ).rejects.toBeInstanceOf(RunnerError);

      await runner.stop();
      const status = await runner.status();
      expect(status.state).toBe('stopped');
      expect(status.error).toContain('tmux');
    });

    it('allows spawn after stop', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      await runner.stop();
      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });

      expect((await runner.status()).state).toBe('running');
    });
  });

  describe('logs() options and status crash detection', () => {
    it('honors sinceByteOffset', async () => {
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'capture-pane') return ok('abcdef');
          if (args[0] === 'list-panes') return ok('0');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      const snapshot = await runner.logs({ sinceByteOffset: 2 });

      expect(snapshot.stdout).toBe('cdef');
    });

    it('transitions to stopped when pane dies while running', async () => {
      let spawnComplete = false;
      const runner = new TmuxRunner('r1', {
        runTmux: async (args) => {
          if (args[0] === 'list-panes' && args.includes('#{pane_dead}')) {
            return ok(spawnComplete ? '1' : '0');
          }
          if (args[0] === 'list-panes') return ok('2');
          return ok();
        }
      });

      await runner.spawn({ binary: 'agent', args: [], cwd: '/tmp' });
      spawnComplete = true;
      const status = await runner.status();

      expect(status.state).toBe('stopped');
      expect(status.exitCode).toBe(2);
    });
  });
});
