import { describe, expect, it } from 'vitest';

import { ScriptedRunner } from '../../src/runners/scripted.js';

describe('ScriptedRunner', () => {
  describe('initial state', () => {
    it('reports state "idle" before spawn() is called', async () => {
      const runner = new ScriptedRunner('r1');

      const status = await runner.status();

      expect(runner.id).toBe('r1');
      expect(status.state).toBe('idle');
      expect(status.startedAt).toBeUndefined();
      expect(status.stoppedAt).toBeUndefined();
      expect(status.exitCode).toBeUndefined();
      expect(status.error).toBeUndefined();
    });

    it('returns empty logs before spawn()', async () => {
      const runner = new ScriptedRunner('r1', { stdout: 'will not appear yet' });

      const snapshot = await runner.logs();

      expect(snapshot.stdout).toBe('');
      expect(snapshot.stderr).toBe('');
      expect(snapshot.combined).toBe('');
      expect(snapshot.truncated).toBe(false);
    });
  });

  describe('spawn() — happy path', () => {
    it('transitions idle → running and records startedAt', async () => {
      const runner = new ScriptedRunner('r1');

      await runner.spawn({ binary: '/bin/true', args: [], cwd: '/tmp' });
      const status = await runner.status();

      expect(status.state).toBe('running');
      expect(status.startedAt).toBeInstanceOf(Date);
      expect(status.exitCode).toBeUndefined();
    });

    it('exposes scripted stdout/stderr after spawn', async () => {
      const runner = new ScriptedRunner('r1', { stdout: 'hello\n', stderr: 'oops\n' });

      await runner.spawn({ binary: '/bin/true', args: [], cwd: '/tmp' });
      const snapshot = await runner.logs();

      expect(snapshot.stdout).toBe('hello\n');
      expect(snapshot.stderr).toBe('oops\n');
      expect(snapshot.combined).toBe('[stdout]\nhello\n\n[stderr]\noops\n');
      expect(snapshot.truncated).toBe(false);
    });

    it('produces combined logs with only the populated half when stderr is empty', async () => {
      const runner = new ScriptedRunner('r1', { stdout: 'only out' });

      await runner.spawn({ binary: '/bin/true', args: [], cwd: '/tmp' });
      const snapshot = await runner.logs();

      expect(snapshot.combined).toBe('[stdout]\nonly out');
    });
  });

  describe('spawn() — invalid state', () => {
    it('rejects with invalid-state when called twice without stop', async () => {
      const runner = new ScriptedRunner('r1');
      await runner.spawn({ binary: '/bin/true', args: [], cwd: '/tmp' });

      await expect(
        runner.spawn({ binary: '/bin/true', args: [], cwd: '/tmp' })
      ).rejects.toMatchObject({
        name: 'RunnerError',
        code: 'invalid-state'
      });
    });
  });
});
