import { describe, expect, it } from 'vitest';

import {
  LocalProcessRunner,
  type SpawnProcess
} from '../../src/runners/local.js';
import * as runners from '../../src/runners/index.js';

describe('LocalProcessRunner', () => {
  describe('initial state', () => {
    it('reports idle before spawn', async () => {
      const runner = new LocalProcessRunner('local-1');
      const status = await runner.status();

      expect(runner.id).toBe('local-1');
      expect(status.state).toBe('idle');
    });

    it('returns empty logs before spawn', async () => {
      const runner = new LocalProcessRunner('local-1');
      const snapshot = await runner.logs();

      expect(snapshot).toEqual({
        stdout: '',
        stderr: '',
        combined: '',
        truncated: false
      });
    });
  });

  describe('spawn() — happy path', () => {
    it('runs a short node script and captures stdout', async () => {
      const runner = new LocalProcessRunner('local-spawn');
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', "process.stdout.write('hi\\n')"],
        cwd: process.cwd()
      });

      for (let i = 0; i < 20; i += 1) {
        if ((await runner.status()).state === 'stopped') break;
        await new Promise((r) => setTimeout(r, 25));
      }

      const status = await runner.status();
      expect(status.state).toBe('stopped');
      expect(status.exitCode).toBe(0);

      const logs = await runner.logs();
      expect(logs.stdout).toContain('hi');
      expect(logs.combined).toBe('[stdout]\nhi\n');
      expect(logs.truncated).toBe(false);
    });

    it('observes running with startedAt before child exits', async () => {
      const runner = new LocalProcessRunner('local-running');
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', 'setInterval(() => {}, 2000)'],
        cwd: process.cwd()
      });

      const status = await runner.status();
      expect(status.state).toBe('running');
      expect(status.startedAt).toBeInstanceOf(Date);
      await runner.stop();
    });

    it('captures stderr on a real process', async () => {
      const runner = new LocalProcessRunner('local-stderr');
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', "process.stderr.write('err\\n')"],
        cwd: process.cwd()
      });
      for (let i = 0; i < 20; i += 1) {
        if ((await runner.status()).state === 'stopped') break;
        await new Promise((r) => setTimeout(r, 25));
      }

      const logs = await runner.logs();
      expect(logs.stderr).toContain('err');
      expect(logs.combined).toBe('[stderr]\nerr\n');
    });
  });

  describe('stop()', () => {
    it('terminates a sleeping child', async () => {
      const runner = new LocalProcessRunner('local-stop', { stopGraceMs: 500 });
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        cwd: process.cwd()
      });
      expect((await runner.status()).state).toBe('running');

      await runner.stop();
      const status = await runner.status();
      expect(status.state).toBe('stopped');
      expect(status.stoppedAt).toBeInstanceOf(Date);
    });

    it('is a no-op from idle', async () => {
      const runner = new LocalProcessRunner('local-idle-stop');
      await runner.stop();
      expect((await runner.status()).state).toBe('idle');
    });

    it('is a no-op from stopped', async () => {
      const runner = new LocalProcessRunner('local-stopped-stop');
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', "process.stdout.write('done')"],
        cwd: process.cwd()
      });
      await new Promise((r) => setTimeout(r, 50));
      await runner.stop();
      await runner.stop();
      expect((await runner.status()).state).toBe('stopped');
    });

    it('stops a child still in starting', async () => {
      let resolveExit!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void;
      const exited = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        resolveExit = resolve;
      });
      const fakeSpawn: SpawnProcess = () => ({
        stdout: null,
        stderr: null,
        kill: () => {
          resolveExit({ exitCode: 0, signal: null });
        },
        exited
      });

      const runner = new LocalProcessRunner('local-stop-starting', {}, { spawnProcess: fakeSpawn });
      const spawnPromise = runner.spawn({ binary: 'fake', args: [], cwd: '/tmp' });
      expect((await runner.status()).state).toBe('starting');
      await runner.stop();
      await spawnPromise;
      expect((await runner.status()).state).toBe('stopped');
    });
  });

  describe('spawn errors and invalid state', () => {
    it('rejects double spawn', async () => {
      const runner = new LocalProcessRunner('local-double');
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', 'setInterval(() => {}, 500)'],
        cwd: process.cwd()
      });

      await expect(
        runner.spawn({ binary: process.execPath, args: ['-e', ''], cwd: process.cwd() })
      ).rejects.toMatchObject({
        name: 'RunnerError',
        code: 'invalid-state'
      });
      await runner.stop();
    });

    it('enters error on missing binary', async () => {
      const runner = new LocalProcessRunner('local-bad-bin');
      await expect(
        runner.spawn({ binary: '/no/such/binary-xyz', args: [], cwd: process.cwd() })
      ).rejects.toMatchObject({ name: 'RunnerError', code: 'spawn-failed' });

      const status = await runner.status();
      expect(status.state).toBe('error');
      expect(status.error).toBeTruthy();
      expect(status.startedAt).toBeInstanceOf(Date);
    });

    it('preserves error message after stop from error state', async () => {
      const runner = new LocalProcessRunner('local-error-stop');
      await expect(
        runner.spawn({ binary: '/no/such/binary-xyz', args: [], cwd: process.cwd() })
      ).rejects.toMatchObject({ code: 'spawn-failed' });

      await runner.stop();
      const status = await runner.status();
      expect(status.state).toBe('stopped');
      expect(status.error).toBeTruthy();
    });
  });

  describe('injectable spawnProcess', () => {
    it('transitions to stopped when child exits unexpectedly', async () => {
      let exitResolve!: (value: { exitCode: number | null; signal: NodeJS.Signals | null }) => void;
      const exited = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((r) => {
        exitResolve = r;
      });
      const fakeSpawn: SpawnProcess = () => ({
        stdout: null,
        stderr: null,
        kill: () => {},
        exited
      });

      const runner = new LocalProcessRunner('local-crash', {}, { spawnProcess: fakeSpawn });
      await runner.spawn({ binary: 'fake', args: [], cwd: '/tmp' });
      expect((await runner.status()).state).toBe('running');

      exitResolve({ exitCode: 1, signal: null });
      await exited;
      await new Promise((r) => setTimeout(r, 0));

      const status = await runner.status();
      expect(status.state).toBe('stopped');
      expect(status.exitCode).toBe(1);
    });

    it('transitions to stopped when child exits during starting', async () => {
      const exited = Promise.resolve({ exitCode: 0, signal: null });
      const fakeSpawn: SpawnProcess = () => ({
        stdout: null,
        stderr: null,
        kill: () => {},
        exited
      });
      const runner = new LocalProcessRunner('local-exit-starting', {}, { spawnProcess: fakeSpawn });
      await runner.spawn({ binary: 'fake', args: [], cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 0));
      expect((await runner.status()).state).toBe('stopped');
    });

    it('records non-zero exit during starting as stopped, not error', async () => {
      const exited = Promise.resolve({ exitCode: 1, signal: null });
      const fakeSpawn: SpawnProcess = () => ({
        stdout: null,
        stderr: null,
        kill: () => {},
        exited
      });
      const runner = new LocalProcessRunner('local-exit-starting-fail', {}, { spawnProcess: fakeSpawn });
      await runner.spawn({ binary: 'fake', args: [], cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 0));
      const status = await runner.status();
      expect(status.state).toBe('stopped');
      expect(status.exitCode).toBe(1);
      expect(status.error).toBeUndefined();
    });

    it('maps signal exit to exitCode 128', async () => {
      const exited = Promise.resolve({ exitCode: null, signal: 'SIGTERM' as NodeJS.Signals });
      const fakeSpawn: SpawnProcess = () => ({
        stdout: null,
        stderr: null,
        kill: () => {},
        exited
      });
      const runner = new LocalProcessRunner('local-signal', {}, { spawnProcess: fakeSpawn });
      await runner.spawn({ binary: 'fake', args: [], cwd: '/tmp' });
      await new Promise((r) => setTimeout(r, 0));
      expect((await runner.status()).exitCode).toBe(128);
    });

    it('rejects stop-failed when kill throws', async () => {
      const fakeSpawn: SpawnProcess = () => ({
        stdout: null,
        stderr: null,
        kill: () => {
          throw new Error('kill failed');
        },
        exited: new Promise(() => {})
      });
      const runner = new LocalProcessRunner('local-stop-fail', {}, { spawnProcess: fakeSpawn });
      await runner.spawn({ binary: 'fake', args: [], cwd: '/tmp' });
      await expect(runner.stop()).rejects.toMatchObject({ code: 'stop-failed' });
      expect((await runner.status()).state).toBe('error');
    });
  });

  describe('log truncation', () => {
    it('sets truncated when combined stdout+stderr exceeds maxLogBytes', async () => {
      const out = 'o'.repeat(40);
      const err = 'e'.repeat(40);
      const runner = new LocalProcessRunner('local-trunc', { maxLogBytes: 50 });
      await runner.spawn({
        binary: process.execPath,
        args: [
          '-e',
          `process.stdout.write(${JSON.stringify(out)}); process.stderr.write(${JSON.stringify(err)})`
        ],
        cwd: process.cwd()
      });
      await new Promise((r) => setTimeout(r, 50));

      const logs = await runner.logs();
      expect(logs.truncated).toBe(true);
      expect(Buffer.byteLength(logs.stdout, 'utf8') + Buffer.byteLength(logs.stderr, 'utf8')).toBeLessThanOrEqual(
        50
      );
    });
  });

  describe('reuse after stop', () => {
    it('allows spawn after stop', async () => {
      const runner = new LocalProcessRunner('local-reuse');
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', 'setInterval(() => {}, 500)'],
        cwd: process.cwd()
      });
      await runner.stop();
      await runner.spawn({
        binary: process.execPath,
        args: ['-e', "process.stdout.write('second')"],
        cwd: process.cwd()
      });
      for (let i = 0; i < 20; i += 1) {
        if ((await runner.status()).state === 'stopped') break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect((await runner.status()).state).toBe('stopped');
      expect((await runner.logs()).stdout).toContain('second');
    });
  });

  describe('status snapshot freshness', () => {
    it('returns a fresh object on each call', async () => {
      const runner = new LocalProcessRunner('local-fresh');
      const first = await runner.status();
      first.state = 'error';
      expect((await runner.status()).state).toBe('idle');
    });
  });
});

describe('runners barrel', () => {
  it('exports LocalProcessRunner from barrel', () => {
    expect(new runners.LocalProcessRunner('x')).toBeInstanceOf(runners.LocalProcessRunner);
  });
});
