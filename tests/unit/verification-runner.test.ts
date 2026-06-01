import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultRunPipelineDeps,
  runVerificationPipeline,
  type ExecCheckResult,
  type RunPipelineDeps
} from '../../src/verification/runner.js';
import type { VerificationConfig } from '../../src/verification/types.js';

const tempDirs: string[] = [];

async function makeRunDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-verify-runner-'));
  tempDirs.push(dir);
  return dir;
}

function buildConfig(): VerificationConfig {
  return {
    verification: {
      checks: [
        { name: 'lint', command: 'lint-cmd', args: ['.'], env: {} },
        { name: 'typecheck', command: 'tsc', args: ['--noEmit'], env: {} },
        { name: 'unit-tests', command: 'vitest', args: ['run'], env: {} }
      ]
    }
  };
}

function makeMonotonicNow(): () => Date {
  const baseMs = Date.parse('2026-06-01T10:00:00.000Z');
  let tick = 0;
  return () => new Date(baseMs + (tick++) * 1000);
}

function buildDeps(overrides: Partial<RunPipelineDeps> = {}): RunPipelineDeps {
  return {
    execCheck: async (_spec, onChunk) => {
      onChunk('stdout', 'stub-output\n');
      return { exitCode: 0, signal: null } satisfies ExecCheckResult;
    },
    now: makeMonotonicNow(),
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('runVerificationPipeline', () => {
  it('passes when every check exits zero', async () => {
    const runDirectory = await makeRunDir();

    const run = await runVerificationPipeline(
      {
        config: buildConfig(),
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: false
      },
      buildDeps()
    );

    expect(run.status).toBe('pass');
    expect(run.checks.map((check) => check.status)).toEqual(['pass', 'pass', 'pass']);
    const lintLog = await fs.readFile(path.join(runDirectory, 'lint.log'), 'utf8');
    expect(lintLog).toContain('[stdout] stub-output');
  });

  it('reports failure but continues without bail when a check fails', async () => {
    const runDirectory = await makeRunDir();
    const calls: string[] = [];

    const run = await runVerificationPipeline(
      {
        config: buildConfig(),
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: false
      },
      buildDeps({
        execCheck: async (spec, onChunk) => {
          calls.push(spec.command);

          if (spec.command === 'tsc') {
            onChunk('stderr', 'type error');
            return { exitCode: 2, signal: null };
          }

          onChunk('stdout', 'ok');
          return { exitCode: 0, signal: null };
        }
      })
    );

    expect(calls).toEqual(['lint-cmd', 'tsc', 'vitest']);
    expect(run.status).toBe('fail');
    expect(run.checks.map((check) => check.status)).toEqual(['pass', 'fail', 'pass']);
    expect(run.checks[1].exitCode).toBe(2);
  });

  it('skips remaining checks when bail is true and a check fails', async () => {
    const runDirectory = await makeRunDir();
    const calls: string[] = [];

    const run = await runVerificationPipeline(
      {
        config: buildConfig(),
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: true
      },
      buildDeps({
        execCheck: async (spec) => {
          calls.push(spec.command);

          if (spec.command === 'lint-cmd') {
            return { exitCode: 1, signal: null };
          }

          return { exitCode: 0, signal: null };
        }
      })
    );

    expect(calls).toEqual(['lint-cmd']);
    expect(run.status).toBe('fail');
    expect(run.checks.map((check) => check.status)).toEqual(['fail', 'skipped', 'skipped']);
  });

  it('records command-not-found as fail with a message in the log', async () => {
    const runDirectory = await makeRunDir();

    const run = await runVerificationPipeline(
      {
        config: {
          verification: {
            checks: [{ name: 'missing', command: 'definitely-not-here', args: [], env: {} }]
          }
        },
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: false
      },
      buildDeps({
        execCheck: async (_spec, onChunk) => {
          onChunk('stderr', 'spawn definitely-not-here ENOENT');
          return { exitCode: null, signal: null };
        }
      })
    );

    expect(run.status).toBe('fail');
    expect(run.checks[0].status).toBe('fail');
    expect(run.checks[0].exitCode).toBeNull();
    const log = await fs.readFile(path.join(runDirectory, 'missing.log'), 'utf8');
    expect(log).toContain('ENOENT');
  });

  it('uses the repo root as default cwd when the check omits it', async () => {
    const runDirectory = await makeRunDir();
    const seen: string[] = [];

    await runVerificationPipeline(
      {
        config: {
          verification: {
            checks: [{ name: 'lint', command: 'eslint', args: [], env: {} }]
          }
        },
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: false
      },
      buildDeps({
        execCheck: async (spec) => {
          seen.push(spec.cwd);
          return { exitCode: 0, signal: null };
        }
      })
    );

    expect(seen).toEqual(['/repo']);
  });

  it('resolves a relative cwd against the repo root', async () => {
    const runDirectory = await makeRunDir();
    const seen: string[] = [];

    await runVerificationPipeline(
      {
        config: {
          verification: {
            checks: [{ name: 'lint', command: 'eslint', args: [], env: {}, cwd: 'packages/app' }]
          }
        },
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: false
      },
      buildDeps({
        execCheck: async (spec) => {
          seen.push(spec.cwd);
          return { exitCode: 0, signal: null };
        }
      })
    );

    expect(seen).toEqual([path.join('/repo', 'packages/app')]);
  });

  it('records signal-killed checks as fail with the signal name', async () => {
    const runDirectory = await makeRunDir();
    const run = await runVerificationPipeline(
      {
        config: { verification: { checks: [{ name: 'lint', command: 'x', args: [], env: {} }] } },
        configPath: '/c',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: 'r',
        bail: false
      },
      {
        execCheck: async () => ({ exitCode: null, signal: 'SIGTERM' }),
        now: makeMonotonicNow()
      }
    );
    expect(run.checks[0].status).toBe('fail');
    expect(run.checks[0].signal).toBe('SIGTERM');
    expect(run.checks[0].exitCode).toBeNull();
    expect(run.status).toBe('fail');
  });

  it('does not mangle prefixes when chunks arrive mid-line', async () => {
    const runDirectory = await makeRunDir();
    const config: VerificationConfig = {
      verification: { checks: [{ name: 'lint', command: 'x', args: [], env: {} }] }
    };
    await runVerificationPipeline(
      { config, configPath: '/c', repoRoot: '/repo', issueNumber: 20, runDirectory, runId: 'r', bail: false },
      {
        execCheck: async (_spec, onChunk) => {
          onChunk('stdout', 'part1 ');
          onChunk('stdout', 'part2\n');
          return { exitCode: 0, signal: null };
        },
        now: makeMonotonicNow()
      }
    );
    const log = await fs.readFile(path.join(runDirectory, 'lint.log'), 'utf8');
    expect(log).toBe('[stdout] part1 part2\n');
  });

  it('marks remaining checks skipped when abortSignal aborts mid-pipeline', async () => {
    const runDirectory = await makeRunDir();
    const controller = new AbortController();
    const calls: string[] = [];

    const run = await runVerificationPipeline(
      {
        config: buildConfig(),
        configPath: '/repo/issueflow.config.json',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: '2026-06-01T10-00-00-000Z',
        bail: false,
        abortSignal: controller.signal
      },
      buildDeps({
        execCheck: async (spec) => {
          calls.push(spec.command);
          if (spec.command === 'lint-cmd') {
            controller.abort();
            return { exitCode: 0, signal: null };
          }
          return { exitCode: 0, signal: null };
        }
      })
    );

    expect(calls).toEqual(['lint-cmd']);
    expect(run.checks.map((check) => check.status)).toEqual(['pass', 'skipped', 'skipped']);
    expect(run.status).toBe('fail');
  });

  it('preserves log line order under many concurrent chunks', async () => {
    const runDirectory = await makeRunDir();
    await runVerificationPipeline(
      {
        config: { verification: { checks: [{ name: 'lint', command: 'x', args: [], env: {} }] } },
        configPath: '/c',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: 'r',
        bail: false
      },
      {
        execCheck: async (_spec, onChunk) => {
          for (let i = 0; i < 50; i += 1) {
            onChunk('stdout', `line-${i}\n`);
          }
          return { exitCode: 0, signal: null };
        },
        now: makeMonotonicNow()
      }
    );
    const log = await fs.readFile(path.join(runDirectory, 'lint.log'), 'utf8');
    const expected = Array.from({ length: 50 }, (_, i) => `[stdout] line-${i}`).join('\n') + '\n';
    expect(log).toBe(expected);
  });

  it('records SIGINT on the running check when abortSignal aborts mid-flight', async () => {
    const runDirectory = await makeRunDir();
    const controller = new AbortController();
    let resolveStarted: () => void;
    const checkStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const runPromise = runVerificationPipeline(
      {
        config: { verification: { checks: [{ name: 'lint', command: 'x', args: [], env: {} }] } },
        configPath: '/c',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: 'r',
        bail: false,
        abortSignal: controller.signal
      },
      {
        execCheck: async (_spec, _onChunk, signal) => {
          resolveStarted();
          await new Promise<void>((resolve) => {
            if (!signal || signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return { exitCode: null, signal: 'SIGINT' };
        },
        now: makeMonotonicNow()
      }
    );

    // Wait until the check has actually started before aborting, otherwise the
    // runner's top-of-loop "aborted?" guard skips the check entirely.
    await checkStarted;
    controller.abort();

    const run = await runPromise;
    expect(run.checks[0].signal).toBe('SIGINT');
    expect(run.checks[0].status).toBe('fail');
    expect(run.status).toBe('fail');
  });

  it('records a real ENOENT failure with the message in the log (default deps)', async () => {
    const runDirectory = await makeRunDir();
    const run = await runVerificationPipeline(
      {
        config: {
          verification: {
            checks: [
              {
                name: 'missing',
                command: 'definitely-not-a-real-binary-xyz-9f3c2a',
                args: [],
                env: {}
              }
            ]
          }
        },
        configPath: '/c',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: 'r',
        bail: false
      },
      defaultRunPipelineDeps
    );

    expect(run.status).toBe('fail');
    expect(run.checks[0].status).toBe('fail');
    const log = await fs.readFile(path.join(runDirectory, 'missing.log'), 'utf8');
    expect(log.toLowerCase()).toMatch(/enoent|not found|spawn/);
  });

  it('persists run.json even if a per-check execCheck throws', async () => {
    const runDirectory = await makeRunDir();

    const run = await runVerificationPipeline(
      {
        config: {
          verification: { checks: [{ name: 'lint', command: 'x', args: [], env: {} }] }
        },
        configPath: '/c',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: 'r',
        bail: false
      },
      {
        execCheck: async () => {
          throw new Error('synthetic execCheck failure');
        },
        now: makeMonotonicNow()
      }
    );

    expect(run.checks[0].status).toBe('fail');
    expect(run.checks[0].exitCode).toBeNull();
    expect(run.status).toBe('fail');

    const runJson = JSON.parse(
      await fs.readFile(path.join(runDirectory, 'run.json'), 'utf8')
    );
    expect(runJson.checks[0].status).toBe('fail');
    expect(runJson.status).toBe('fail');
  });

  it('preserves pre-throw chunks and appends the synthetic error to the same log', async () => {
    const runDirectory = await makeRunDir();
    const run = await runVerificationPipeline(
      {
        config: { verification: { checks: [{ name: 'lint', command: 'x', args: [], env: {} }] } },
        configPath: '/c',
        repoRoot: '/repo',
        issueNumber: 20,
        runDirectory,
        runId: 'r',
        bail: false
      },
      {
        execCheck: async (_spec, onChunk) => {
          onChunk('stdout', 'pre-error output\n');
          throw new Error('synthetic mid-check failure');
        },
        now: makeMonotonicNow()
      }
    );

    expect(run.checks[0].status).toBe('fail');
    const log = await fs.readFile(path.join(runDirectory, 'lint.log'), 'utf8');
    expect(log).toContain('[stdout] pre-error output');
    expect(log).toContain('[stderr] synthetic mid-check failure');
    expect(log.indexOf('[stdout] pre-error output')).toBeLessThan(log.indexOf('[stderr] synthetic mid-check failure'));
  });
});
