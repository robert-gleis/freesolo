import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  runGateRoute,
  type GateRouteDeps,
  type GateRouteInput,
  type FailureContext
} from '../../src/verification/route-runner.js';
import type { ExecCheckResult } from '../../src/verification/runner.js';
import type { GateRouteConfig, RouteCheck } from '../../src/verification/types.js';

const tempDirs: string[] = [];

async function makeRunDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-route-runner-'));
  tempDirs.push(dir);
  return dir;
}

function makeMonotonicNow(): () => Date {
  const baseMs = Date.parse('2026-07-03T10:00:00.000Z');
  let tick = 0;
  return () => new Date(baseMs + tick++ * 1000);
}

function shell(name: string, command: string, extra: Partial<RouteCheck> = {}): RouteCheck {
  return { name, kind: 'shell', command, args: [], env: {}, ...extra } as RouteCheck;
}

function makeConfig(overrides: Partial<GateRouteConfig> = {}): GateRouteConfig {
  return {
    maxAttempts: 1,
    bail: true,
    checks: [shell('build', 'build-cmd'), shell('test', 'test-cmd')],
    fixer: { host: 'codex', promptPreset: 'gate-fixer' },
    ...overrides
  };
}

function makeInput(config: GateRouteConfig, runDirectory: string): GateRouteInput {
  return {
    config,
    routeConfigPath: '/repo/issueflow.config.json',
    repoRoot: '/repo',
    issueNumber: 7,
    candidateBranch: 'candidate/7',
    runDirectory,
    runId: '2026-07-03T10-00-00-000Z'
  };
}

function makeDeps(overrides: Partial<GateRouteDeps> = {}): GateRouteDeps {
  return {
    execCheck: async (_spec, onChunk): Promise<ExecCheckResult> => {
      onChunk('stdout', 'hi\n');
      return { exitCode: 0, signal: null };
    },
    runAgentReview: async () => ({ status: 'pass', artifactPath: null, findings: null }),
    runFixer: async () => ({ status: 'pass', detail: 'fixed', log: '' }),
    writeRun: async () => {},
    now: makeMonotonicNow(),
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('runGateRoute', () => {
  it('passes when every shell check exits zero on the first attempt', async () => {
    const runDirectory = await makeRunDir();
    const run = await runGateRoute(makeInput(makeConfig(), runDirectory), makeDeps());

    expect(run.status).toBe('pass');
    expect(run.schemaVersion).toBe(2);
    expect(run.attemptsUsed).toBe(1);
    expect(run.attempts).toHaveLength(1);
    expect(run.attempts[0].checks.map((c) => c.status)).toEqual(['pass', 'pass']);
    // final-attempt checks mirrored onto `checks` for downstream consumers
    expect(run.checks.map((c) => c.status)).toEqual(['pass', 'pass']);
    const buildLog = await fs.readFile(path.join(runDirectory, 'attempt-1-build.log'), 'utf8');
    expect(buildLog).toContain('[stdout] hi');
  });

  it('fails on a single attempt when a shell check exits non-zero', async () => {
    const runDirectory = await makeRunDir();
    const run = await runGateRoute(
      makeInput(makeConfig(), runDirectory),
      makeDeps({
        execCheck: async (spec) =>
          spec.command === 'test-cmd' ? { exitCode: 1, signal: null } : { exitCode: 0, signal: null }
      })
    );

    expect(run.status).toBe('fail');
    expect(run.attemptsUsed).toBe(1);
    expect(run.attempts[0].checks.map((c) => c.status)).toEqual(['pass', 'fail']);
    expect(run.attempts[0].checks[1].exitCode).toBe(1);
  });

  it('counts the first attempt within maxAttempts and fails after the last', async () => {
    const runDirectory = await makeRunDir();
    let fixerCalls = 0;
    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 3 }), runDirectory),
      makeDeps({
        execCheck: async () => ({ exitCode: 1, signal: null }),
        runFixer: async () => {
          fixerCalls += 1;
          return { status: 'pass', detail: 'tried', log: '' };
        }
      })
    );

    expect(run.status).toBe('fail');
    expect(run.attemptsUsed).toBe(3);
    expect(run.attempts).toHaveLength(3);
    // fixer runs only between attempts, so 3 attempts => 2 fixer runs
    expect(fixerCalls).toBe(2);
    expect(run.fixerInvocations).toHaveLength(2);
  });

  it('bail=true stops the attempt at the first failing check', async () => {
    const runDirectory = await makeRunDir();
    const calls: string[] = [];
    const run = await runGateRoute(
      makeInput(makeConfig({ bail: true }), runDirectory),
      makeDeps({
        execCheck: async (spec) => {
          calls.push(spec.command);
          return { exitCode: 1, signal: null };
        }
      })
    );

    expect(calls).toEqual(['build-cmd']);
    expect(run.attempts[0].checks.map((c) => c.status)).toEqual(['fail', 'skipped']);
    expect(run.status).toBe('fail');
  });

  it('bail=false runs every check and records all results', async () => {
    const runDirectory = await makeRunDir();
    const calls: string[] = [];
    const run = await runGateRoute(
      makeInput(makeConfig({ bail: false }), runDirectory),
      makeDeps({
        execCheck: async (spec) => {
          calls.push(spec.command);
          return { exitCode: 1, signal: null };
        }
      })
    );

    expect(calls).toEqual(['build-cmd', 'test-cmd']);
    expect(run.attempts[0].checks.map((c) => c.status)).toEqual(['fail', 'fail']);
    expect(run.status).toBe('fail');
  });

  it('reruns the WHOLE route from the first check after a successful fix', async () => {
    const runDirectory = await makeRunDir();
    const order: string[] = [];
    let attempt = 0;

    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 2, bail: true }), runDirectory),
      makeDeps({
        execCheck: async (spec) => {
          order.push(`a${attempt}:${spec.command}`);
          // build always passes; test fails on attempt 0, passes on attempt 1
          if (spec.command === 'test-cmd' && attempt === 0) {
            return { exitCode: 1, signal: null };
          }
          return { exitCode: 0, signal: null };
        },
        runFixer: async () => {
          attempt += 1;
          return { status: 'pass', detail: 'flipped test', log: '' };
        }
      })
    );

    expect(run.status).toBe('pass');
    expect(run.attemptsUsed).toBe(2);
    // Attempt 1 (index 0): build then test (fail). Attempt 2: build AGAIN then test.
    expect(order).toEqual([
      'a0:build-cmd',
      'a0:test-cmd',
      'a1:build-cmd',
      'a1:test-cmd'
    ]);
    expect(run.attempts[1].checks.map((c) => c.name)[0]).toBe('build');
  });

  it('fails immediately when the fixer fails', async () => {
    const runDirectory = await makeRunDir();
    let fixerCalls = 0;
    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 3 }), runDirectory),
      makeDeps({
        execCheck: async () => ({ exitCode: 1, signal: null }),
        runFixer: async () => {
          fixerCalls += 1;
          return { status: 'fail', detail: 'could not fix', log: '' };
        }
      })
    );

    expect(run.status).toBe('fail');
    expect(fixerCalls).toBe(1);
    expect(run.attemptsUsed).toBe(1);
    expect(run.fixerInvocations[0].status).toBe('fail');
  });

  // ponytail: at the runner layer a fixer timeout is indistinguishable from a
  // fixer failure — both collapse to `fixer.status !== 'pass'` in route-runner.ts
  // and fail the route immediately. The timeout-vs-failure distinction (honoring
  // fixer.timeoutSeconds via an abortSignal and surfacing a timeout-specific
  // result) is delegated to the real Fixer Agent seam in A3, so this test does
  // NOT claim to cover the timeout dimension. What it uniquely covers over the
  // 'fixer fails' test above is the *structured FailureContext* handed to the
  // fixer: attempt number, the failed check's name/exitCode, and its log path.
  it('hands the fixer a structured FailureContext for the failed checks', async () => {
    const runDirectory = await makeRunDir();
    let captured: FailureContext | null = null;
    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 3, bail: false }), runDirectory),
      makeDeps({
        execCheck: async (spec) =>
          spec.command === 'test-cmd' ? { exitCode: 2, signal: null } : { exitCode: 0, signal: null },
        runFixer: async (context) => {
          captured = context;
          return { status: 'fail', detail: 'could not fix', log: '' };
        }
      })
    );

    expect(run.status).toBe('fail');
    expect(captured).not.toBeNull();
    const ctx = captured as unknown as FailureContext;
    expect(ctx.attempt).toBe(1);
    expect(ctx.failedChecks.map((c) => c.name)).toEqual(['test']);
    expect(ctx.failedChecks[0].exitCode).toBe(2);
    expect(typeof ctx.failedChecks[0].logPath).toBe('string');
  });

  it('writes a run record readable via the injected store writer', async () => {
    const runDirectory = await makeRunDir();
    let written: unknown = null;
    await runGateRoute(
      makeInput(makeConfig(), runDirectory),
      makeDeps({
        writeRun: async (run) => {
          written = run;
        }
      })
    );

    expect(written).not.toBeNull();
    const record = written as { status: string; runId: string; schemaVersion: number };
    expect(record.status).toBe('pass');
    expect(record.runId).toBe('2026-07-03T10-00-00-000Z');
    expect(record.schemaVersion).toBe(2);
  });

  it('marks an agent-review check failed and calls the fixer with review findings', async () => {
    const runDirectory = await makeRunDir();
    let captured: FailureContext | null = null;
    const config = makeConfig({
      maxAttempts: 2,
      bail: true,
      checks: [
        shell('build', 'build-cmd'),
        {
          name: 'review',
          kind: 'agent-review',
          host: 'codex',
          promptPreset: 'thermonuclear-review'
        }
      ]
    });

    let reviewAttempt = 0;
    const run = await runGateRoute(
      makeInput(config, runDirectory),
      makeDeps({
        runAgentReview: async () => {
          reviewAttempt += 1;
          if (reviewAttempt === 1) {
            return { status: 'fail', artifactPath: '/artifacts/review-1.md', findings: 'blocking: bug' };
          }
          return { status: 'pass', artifactPath: '/artifacts/review-2.md', findings: null };
        },
        runFixer: async (context) => {
          captured = context;
          return { status: 'pass', detail: 'fixed the bug', log: '' };
        }
      })
    );

    expect(run.status).toBe('pass');
    expect(run.attemptsUsed).toBe(2);
    expect(captured).not.toBeNull();
    const ctx = captured as unknown as FailureContext;
    expect(ctx.failedChecks[0].reviewFindings).toBe('blocking: bug');
    expect(run.reviewArtifactPaths).toContain('/artifacts/review-1.md');
    expect(run.reviewArtifactPaths).toContain('/artifacts/review-2.md');
  });
});

describe('defaultGateRouteDeps stubs', () => {
  it('runAgentReview default reports a clear not-implemented failure', async () => {
    const { defaultGateRouteDeps } = await import('../../src/verification/route-runner.js');
    const result = await defaultGateRouteDeps.runAgentReview({
      check: { name: 'review', kind: 'agent-review', host: 'codex', promptPreset: 'x' },
      repoRoot: '/repo',
      issueNumber: 7,
      candidateBranch: 'candidate/7',
      attempt: 1,
      runDirectory: '/tmp',
      logPath: '/tmp/review.log'
    });
    expect(result.status).toBe('fail');
    expect(result.findings ?? '').toContain('not implemented');
  });

  it('runFixer default reports a clear not-implemented failure', async () => {
    const { defaultGateRouteDeps } = await import('../../src/verification/route-runner.js');
    const result = await defaultGateRouteDeps.runFixer({
      attempt: 1,
      repoRoot: '/repo',
      issueNumber: 7,
      candidateBranch: 'candidate/7',
      fixer: { host: 'codex', promptPreset: 'gate-fixer' },
      failedChecks: [],
      logPath: '/tmp/fixer.log',
      runDirectory: '/tmp'
    });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('not implemented');
  });

  it('writeRun default IS the canonical store writer, not a reimplementation', async () => {
    const { defaultGateRouteDeps } = await import('../../src/verification/route-runner.js');
    const { writeRun } = await import('../../src/verification/store.js');
    expect(defaultGateRouteDeps.writeRun).toBe(writeRun);
  });
});
