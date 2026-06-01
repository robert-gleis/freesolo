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
});
