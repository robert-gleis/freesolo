import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import type { AgentAdapter } from '../../src/agents/types.js';
import {
  runGateRoute,
  type GateRouteDeps,
  type GateRouteInput,
  type FailureContext
} from '../../src/verification/route-runner.js';
import {
  runAgentReviewCheck,
  type AgentReviewDeps
} from '../../src/verification/agent-review-check.js';
import { runFixerCheck, type FixerCheckDeps } from '../../src/verification/fixer-check.js';
import { runReviewAgent } from '../../src/agents/review-runner.js';
import type { ExecCheckResult } from '../../src/verification/runner.js';
import type { GateRouteConfig, RouteCheck } from '../../src/verification/types.js';

const PASS_VERDICT = JSON.stringify({ verdict: 'pass', findings: [] });
const FAIL_VERDICT = JSON.stringify({
  verdict: 'fail',
  findings: [{ severity: 'high', message: 'blocking correctness bug' }]
});

/** Fake AgentReviewDeps driven by a ScriptedAgentAdapter, for route-level tests. */
function reviewDepsWith(output: string): AgentReviewDeps {
  return {
    getAgentAdapter: () => new ScriptedAgentAdapter({ steps: [{ match: /.*/, output }] }),
    getBranchDiff: async () => 'diff',
    getIssueBody: async () => 'body',
    listAdrs: async () => [],
    loadKnowledgeEntries: async () => [],
    runReviewAgent
  };
}

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
    baseBranch: 'main',
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
    // spec line 134: the Failure Context must carry the failed check's command.
    expect(ctx.failedChecks[0].command).toBe('test-cmd');
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

describe('runGateRoute with the REAL agent-review check (scripted adapter)', () => {
  function reviewConfig(): GateRouteConfig {
    return makeConfig({
      maxAttempts: 1,
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
  }

  it('passes the route when the scripted review agent returns a pass verdict and writes the artifact', async () => {
    const runDirectory = await makeRunDir();
    const run = await runGateRoute(
      makeInput(reviewConfig(), runDirectory),
      makeDeps({
        runAgentReview: (request) => runAgentReviewCheck(request, reviewDepsWith(PASS_VERDICT))
      })
    );

    expect(run.status).toBe('pass');
    const artifactPath = path.join(runDirectory, 'attempt-1-review-review.json');
    expect(run.reviewArtifactPaths).toContain(artifactPath);
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    expect(artifact.verdict).toBe('pass');
  });

  it('fails the route (single attempt) when the scripted review agent returns fail, capturing findings + artifact', async () => {
    const runDirectory = await makeRunDir();
    const run = await runGateRoute(
      makeInput(reviewConfig(), runDirectory),
      makeDeps({
        runAgentReview: (request) => runAgentReviewCheck(request, reviewDepsWith(FAIL_VERDICT))
      })
    );

    expect(run.status).toBe('fail');
    const reviewCheck = run.attempts[0].checks.find((c) => c.name === 'review');
    expect(reviewCheck?.status).toBe('fail');
    expect(reviewCheck?.reviewFindings ?? '').toContain('blocking correctness bug');
    const artifactPath = path.join(runDirectory, 'attempt-1-review-review.json');
    expect(run.reviewArtifactPaths).toContain(artifactPath);
    const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'));
    expect(artifact.verdict).toBe('fail');
  });

  it('runs the fixer path when the review fails and attempts remain, then passes on the fixed rerun', async () => {
    const runDirectory = await makeRunDir();
    let capturedFindings: string | null | undefined;
    let attempt = 0;

    const run = await runGateRoute(
      makeInput(makeConfig({ ...reviewConfig(), maxAttempts: 2 }), runDirectory),
      makeDeps({
        runAgentReview: (request) => {
          attempt += 1;
          const output = attempt === 1 ? FAIL_VERDICT : PASS_VERDICT;
          return runAgentReviewCheck(request, reviewDepsWith(output));
        },
        runFixer: async (context) => {
          capturedFindings = context.failedChecks[0]?.reviewFindings;
          return { status: 'pass', detail: 'fixed', log: '' };
        }
      })
    );

    expect(run.status).toBe('pass');
    expect(run.attemptsUsed).toBe(2);
    expect(capturedFindings ?? '').toContain('blocking correctness bug');
  });

  it('preserves BOTH attempts review artifacts on disk with distinct verdicts and distinct paths', async () => {
    const runDirectory = await makeRunDir();
    let attempt = 0;

    const run = await runGateRoute(
      makeInput(makeConfig({ ...reviewConfig(), maxAttempts: 2 }), runDirectory),
      makeDeps({
        runAgentReview: (request) => {
          attempt += 1;
          const output = attempt === 1 ? FAIL_VERDICT : PASS_VERDICT;
          return runAgentReviewCheck(request, reviewDepsWith(output));
        },
        runFixer: async () => ({ status: 'pass', detail: 'fixed', log: '' })
      })
    );

    expect(run.status).toBe('pass');
    expect(run.attemptsUsed).toBe(2);

    const attempt1Artifact = path.join(runDirectory, 'attempt-1-review-review.json');
    const attempt2Artifact = path.join(runDirectory, 'attempt-2-review-review.json');

    // Two DISTINCT artifact paths recorded, one per attempt — attempt 2 did not clobber attempt 1.
    expect(run.reviewArtifactPaths).toContain(attempt1Artifact);
    expect(run.reviewArtifactPaths).toContain(attempt2Artifact);
    expect(new Set(run.reviewArtifactPaths).size).toBe(run.reviewArtifactPaths.length);

    // Both files survive on disk, each holding its own attempt's verdict.
    const first = JSON.parse(await fs.readFile(attempt1Artifact, 'utf8'));
    const second = JSON.parse(await fs.readFile(attempt2Artifact, 'utf8'));
    expect(first.verdict).toBe('fail');
    expect(second.verdict).toBe('pass');
  });

  it('fails the route when the scripted review agent returns unparseable output (never silently passes)', async () => {
    const runDirectory = await makeRunDir();
    const run = await runGateRoute(
      makeInput(reviewConfig(), runDirectory),
      makeDeps({
        runAgentReview: (request) => runAgentReviewCheck(request, reviewDepsWith('not json at all'))
      })
    );

    expect(run.status).toBe('fail');
    const artifact = JSON.parse(
      await fs.readFile(path.join(runDirectory, 'attempt-1-review-review.json'), 'utf8')
    );
    expect(artifact.verdict).toBe('fail');
  });
});

describe('runGateRoute with the REAL fixer (scripted adapter)', () => {
  /**
   * Wires the REAL default runFixer (runFixerCheck) into the route with a
   * ScriptedAgentAdapter and fake git/gh loaders, so the whole fixer path runs:
   * FailureContext assembly -> gate-fixer prompt -> agent send -> fixer log.
   * `onFixerSend` lets the test observe the fix "landing" (the agent completing)
   * and flip the shell check to passing for the rerun.
   */
  function realFixerDep(
    adapter: AgentAdapter,
    depOverrides: Partial<FixerCheckDeps> = {}
  ): GateRouteDeps['runFixer'] {
    const fixerDeps: FixerCheckDeps = {
      getAgentAdapter: () => adapter,
      getBranchDiff: async () => 'diff --git a/x b/x',
      getIssueBody: async () => 'issue body',
      ...depOverrides
    };
    return (context) => runFixerCheck(context, fixerDeps);
  }

  it('reruns from the FIRST check on attempt 2 after the real scripted fixer completes, and records the fixer log + invocation', async () => {
    const runDirectory = await makeRunDir();
    const order: string[] = [];
    let fixed = false;
    // The scripted fixer "applies the fix" on completion: flip the failing check.
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'applied the minimal fix' }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      const response = await original(input);
      fixed = true;
      return response;
    };

    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 2, bail: true }), runDirectory),
      makeDeps({
        execCheck: async (spec) => {
          order.push(spec.command);
          // test-cmd fails until the fixer has run; build always passes.
          if (spec.command === 'test-cmd' && !fixed) {
            return { exitCode: 1, signal: null };
          }
          return { exitCode: 0, signal: null };
        },
        runFixer: realFixerDep(adapter)
      })
    );

    expect(run.status).toBe('pass');
    expect(run.attemptsUsed).toBe(2);
    // Attempt 1: build, test (fail). Attempt 2 reruns from the FIRST check: build, test.
    expect(order).toEqual(['build-cmd', 'test-cmd', 'build-cmd', 'test-cmd']);
    expect(run.attempts[1].checks[0].name).toBe('build');

    // The fixer invocation is recorded and the fixer log was written with the agent output.
    expect(run.fixerInvocations).toHaveLength(1);
    expect(run.fixerInvocations[0].afterAttempt).toBe(1);
    expect(run.fixerInvocations[0].status).toBe('pass');
    const fixerLogPath = path.join(runDirectory, 'fixer-attempt-1.log');
    expect(run.fixerInvocations[0].logPath).toBe(fixerLogPath);
    const fixerLog = await fs.readFile(fixerLogPath, 'utf8');
    expect(fixerLog).toContain('applied the minimal fix');
  });

  it('hands the real fixer a Failure Context whose gate-fixer prompt carries the failed check name, exit code, and log summary', async () => {
    const runDirectory = await makeRunDir();
    let capturedPrompt = '';
    let fixed = false;
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
    const original = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      capturedPrompt = input;
      fixed = true;
      return original(input);
    };

    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 2, bail: true }), runDirectory),
      makeDeps({
        execCheck: async (spec, onChunk) => {
          if (spec.command === 'test-cmd' && !fixed) {
            onChunk('stderr', 'AssertionError: expected 1 to equal 2\n');
            return { exitCode: 3, signal: null };
          }
          return { exitCode: 0, signal: null };
        },
        runFixer: realFixerDep(adapter)
      })
    );

    expect(run.status).toBe('pass');
    // The failed check identity, its exit code, and a tail of its log all reach the fixer.
    expect(capturedPrompt).toContain('test');
    expect(capturedPrompt).toContain('exit code: 3');
    expect(capturedPrompt).toContain('AssertionError: expected 1 to equal 2');
  });

  it('fails the route immediately when the real fixer agent errors (no attempt 2)', async () => {
    const runDirectory = await makeRunDir();
    const order: string[] = [];
    const crashing: AgentAdapter = {
      start: async () => {},
      stop: async () => {},
      send: async () => {
        throw new Error('agent crashed');
      },
      status: async () => ({ state: 'idle' })
    };

    const run = await runGateRoute(
      makeInput(makeConfig({ maxAttempts: 3, bail: true }), runDirectory),
      makeDeps({
        execCheck: async (spec) => {
          order.push(spec.command);
          return spec.command === 'test-cmd'
            ? { exitCode: 1, signal: null }
            : { exitCode: 0, signal: null };
        },
        runFixer: realFixerDep(crashing)
      })
    );

    expect(run.status).toBe('fail');
    expect(run.attemptsUsed).toBe(1);
    // Only attempt 1 ran — a fixer error fails the route before any rerun.
    expect(order).toEqual(['build-cmd', 'test-cmd']);
    expect(run.fixerInvocations).toHaveLength(1);
    expect(run.fixerInvocations[0].status).toBe('fail');
    expect(run.fixerInvocations[0].detail).toContain('agent crashed');
  });
});

describe('defaultGateRouteDeps stubs', () => {
  it('runAgentReview default delegates to the real fail-soft check (no longer a not-implemented stub)', async () => {
    const runDirectory = await makeRunDir();
    const { defaultGateRouteDeps } = await import('../../src/verification/route-runner.js');
    // repoRoot points at a non-git temp dir, so context assembly (getBranchDiff)
    // fails; the real check must fail SOFT (fail verdict + artifact), never throw,
    // and never emit the old "not implemented" text.
    const result = await defaultGateRouteDeps.runAgentReview({
      check: { name: 'review', kind: 'agent-review', host: 'codex', promptPreset: 'thermonuclear-review' },
      repoRoot: runDirectory,
      issueNumber: 7,
      candidateBranch: 'candidate/7',
      baseBranch: 'main',
      attempt: 1,
      runDirectory,
      logPath: path.join(runDirectory, 'attempt-1-review.log')
    });
    expect(result.status).toBe('fail');
    expect(result.findings ?? '').not.toContain('not implemented');
    expect(result.artifactPath).toBe(path.join(runDirectory, 'attempt-1-review-review.json'));
    const artifact = JSON.parse(await fs.readFile(result.artifactPath as string, 'utf8'));
    expect(artifact.verdict).toBe('fail');
  });

  it('runFixer default delegates to the real fixer (no longer a not-implemented stub)', async () => {
    const runDirectory = await makeRunDir();
    const { defaultGateRouteDeps } = await import('../../src/verification/route-runner.js');
    // repoRoot points at a non-git temp dir, so context assembly (getBranchDiff)
    // fails; the real fixer must fail SOFT (fail status), never throw, and never
    // emit the old "not implemented" text.
    const result = await defaultGateRouteDeps.runFixer({
      attempt: 1,
      repoRoot: runDirectory,
      issueNumber: 7,
      candidateBranch: 'candidate/7',
      baseBranch: 'main',
      fixer: { host: 'codex', promptPreset: 'gate-fixer' },
      failedChecks: [
        {
          name: 'build',
          kind: 'shell',
          command: 'npm run build',
          exitCode: 2,
          logPath: path.join(runDirectory, 'attempt-1-build.log'),
          reviewFindings: null
        }
      ],
      logPath: path.join(runDirectory, 'fixer-attempt-1.log'),
      runDirectory
    });
    expect(result.status).toBe('fail');
    expect(result.detail).not.toContain('not implemented');
  });

  it('writeRun default IS the canonical store writer, not a reimplementation', async () => {
    const { defaultGateRouteDeps } = await import('../../src/verification/route-runner.js');
    const { writeRun } = await import('../../src/verification/store.js');
    expect(defaultGateRouteDeps.writeRun).toBe(writeRun);
  });
});
