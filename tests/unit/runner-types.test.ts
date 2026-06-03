import { describe, expect, it } from 'vitest';

import {
  RunnerError,
  type LogOptions,
  type LogSnapshot,
  type Runner,
  type RunnerId,
  type RunnerState,
  type RunnerStatus,
  type SpawnSpec
} from '../../src/runners/types.js';

describe('Runner (structural)', () => {
  it('accepts a minimal in-line implementation', async () => {
    const runner: Runner = {
      id: 'r1' as RunnerId,
      spawn: async (_spec: SpawnSpec) => {},
      stop: async () => {},
      logs: async (_options?: LogOptions): Promise<LogSnapshot> => ({
        stdout: '',
        stderr: '',
        combined: '',
        truncated: false
      }),
      status: async (): Promise<RunnerStatus> => ({ state: 'idle' })
    };

    const status = await runner.status();
    const snapshot = await runner.logs();

    expect(runner.id).toBe('r1');
    expect(status.state).toBe('idle');
    expect(snapshot.truncated).toBe(false);
  });

  it('SpawnSpec carries binary, args, cwd, and optional env', () => {
    const spec: SpawnSpec = {
      binary: '/usr/bin/echo',
      args: ['hello'],
      cwd: '/tmp/work',
      env: { FOO: 'bar' }
    };

    expect(spec.binary).toBe('/usr/bin/echo');
    expect(spec.args).toEqual(['hello']);
    expect(spec.env).toEqual({ FOO: 'bar' });
  });

  it('LogOptions.sinceByteOffset is optional', () => {
    const empty: LogOptions = {};
    const withOffset: LogOptions = { sinceByteOffset: 128 };

    expect(empty.sinceByteOffset).toBeUndefined();
    expect(withOffset.sinceByteOffset).toBe(128);
  });

  it('pins the RunnerState union shape', () => {
    const allStates: RunnerState[] = [
      'idle',
      'starting',
      'running',
      'stopping',
      'stopped',
      'error'
    ];
    expect(allStates).toHaveLength(6);
  });
});

describe('RunnerError', () => {
  it('carries a code and message and is an Error', () => {
    const error = new RunnerError('invalid-state', 'wrong state');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RunnerError');
    expect(error.code).toBe('invalid-state');
    expect(error.message).toBe('wrong state');
  });

  it('supports every documented error code', () => {
    const codes = ['invalid-state', 'spawn-failed', 'stop-failed', 'logs-unavailable'] as const;
    for (const code of codes) {
      const error = new RunnerError(code, 'msg');
      expect(error.code).toBe(code);
    }
  });
});

import * as runnersBarrel from '../../src/runners/index.js';
import type { Runner as RunnerType } from '../../src/runners/index.js';

describe('src/runners barrel re-export', () => {
  it('exposes RunnerError and ScriptedRunner as values', () => {
    expect(typeof runnersBarrel.RunnerError).toBe('function');
    expect(typeof runnersBarrel.ScriptedRunner).toBe('function');
  });

  it('exposes Runner as a type that ScriptedRunner satisfies', () => {
    const runner: RunnerType = new runnersBarrel.ScriptedRunner('r1');
    expect(runner.id).toBe('r1');
  });

  it('exposes TmuxRunner as a value that satisfies Runner', () => {
    expect(typeof runnersBarrel.TmuxRunner).toBe('function');
    const runner: RunnerType = new runnersBarrel.TmuxRunner('r1', {
      runTmux: async () => ({ stdout: '', stderr: '', exitCode: 0 })
    });
    expect(runner.id).toBe('r1');
  });
});
