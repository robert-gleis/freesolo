import { describe, expect, it } from 'vitest';

import { createVerifyPlan, type VerifyPlanDeps } from '../../src/commands/verify.js';
import { IssueIdError } from '../../src/core/issue-id.js';
import { VerificationConfigError } from '../../src/verification/config.js';
import type { GateRouteInput } from '../../src/verification/route-runner.js';
import type { GateRouteRun, RouteCheckResult, VerificationConfig } from '../../src/verification/types.js';

function makeConfig(): VerificationConfig {
  return {
    verification: {
      gateRoute: {
        maxAttempts: 2,
        bail: true,
        checks: [
          { name: 'lint', kind: 'shell', command: 'lint-cmd', args: [], env: {} },
          { name: 'typecheck', kind: 'shell', command: 'tsc', args: ['--noEmit'], env: {} }
        ],
        fixer: { host: 'codex', promptPreset: 'gate-fixer' }
      }
    }
  };
}

function passCheck(name: string): RouteCheckResult {
  return {
    name,
    kind: 'shell',
    status: 'pass',
    command: name,
    exitCode: 0,
    signal: null,
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: '2026-06-01T10:00:01.000Z',
    durationMs: 1000,
    logPath: `/run/${name}.log`
  };
}

function buildRun(input: GateRouteInput, overrides: Partial<GateRouteRun> = {}): GateRouteRun {
  const checks = input.config.checks.map((check) => passCheck(check.name));
  return {
    schemaVersion: 2,
    runId: input.runId,
    issueNumber: input.issueNumber,
    repoRoot: input.repoRoot,
    configPath: input.routeConfigPath,
    startedAt: '2026-06-01T10:00:00.000Z',
    finishedAt: '2026-06-01T10:00:01.000Z',
    status: 'pass',
    bail: input.config.bail,
    checks: checks.map((c) => ({
      name: c.name,
      command: c.command ?? c.kind,
      args: [],
      cwd: input.repoRoot,
      status: c.status,
      exitCode: c.exitCode,
      signal: c.signal,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      durationMs: c.durationMs,
      logPath: c.logPath
    })),
    candidateBranch: input.candidateBranch,
    routeConfigPath: input.routeConfigPath,
    maxAttempts: input.config.maxAttempts,
    attemptsUsed: 1,
    attempts: [{ attempt: 1, status: 'pass', checks }],
    reviewArtifactPaths: [],
    fixerInvocations: [],
    ...overrides
  };
}

function makeDeps(overrides: Partial<VerifyPlanDeps> = {}): VerifyPlanDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    resolveIssueNumber: async (_repoRoot, override) => override ?? 20,
    loadVerificationConfig: async () => makeConfig(),
    resolveCandidateBranch: async () => ({ branchName: 'candidate/20', baseBranch: 'main' }),
    getRunDirectory: async (_repoRoot, issueNumber, runId) =>
      `/repo/.git/issueflow/verifications/issue-${issueNumber}/${runId}`,
    runRoute: async (input) => buildRun(input),
    now: () => new Date('2026-06-01T10:00:00.000Z'),
    newRunId: () => '2026-06-01T10-00-00-000Z',
    ...overrides
  };
}

describe('createVerifyPlan', () => {
  it('returns a print-only result without invoking the route', async () => {
    const calls: string[] = [];

    const result = await createVerifyPlan(
      { cwd: '/cwd', options: { printOnly: true } },
      makeDeps({
        runRoute: async (input) => {
          calls.push('runRoute');
          return buildRun(input);
        }
      })
    );

    expect(calls).toEqual([]);
    expect(result.mode).toBe('print-only');
    if (result.mode === 'print-only') {
      expect(result.summaryLines.join('\n')).toContain('lint');
      expect(result.summaryLines.join('\n')).toContain('typecheck');
      expect(result.summaryLines.join('\n')).toContain('issue-20');
      expect(result.summaryLines.join('\n')).toContain('Max attempts: 2');
    }
  });

  it('returns a completed run when the route reports pass', async () => {
    const result = await createVerifyPlan({ cwd: '/cwd', options: {} }, makeDeps());

    expect(result.mode).toBe('completed');
    if (result.mode === 'completed') {
      expect(result.run.status).toBe('pass');
      expect(result.exitCode).toBe(0);
    }
  });

  it('returns a completed run with exit 1 when the route reports fail', async () => {
    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        runRoute: async (input) => buildRun(input, { status: 'fail', checks: [] })
      })
    );

    expect(result.mode).toBe('completed');
    if (result.mode === 'completed') {
      expect(result.exitCode).toBe(1);
    }
  });

  it('maps a run with a SIGINT-signalled check to exit code 130', async () => {
    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        runRoute: async (input) =>
          buildRun(input, {
            status: 'fail',
            checks: [
              {
                name: 'lint',
                command: 'lint-cmd',
                args: [],
                cwd: input.repoRoot,
                status: 'fail',
                exitCode: null,
                signal: 'SIGINT',
                startedAt: '2026-06-01T10:00:00.000Z',
                finishedAt: '2026-06-01T10:00:01.000Z',
                durationMs: 1000,
                logPath: '/run/lint.log'
              }
            ]
          })
      })
    );

    expect(result.mode).toBe('completed');
    if (result.mode === 'completed') {
      expect(result.exitCode).toBe(130);
    }
  });

  it('returns an error result when issue id cannot be resolved', async () => {
    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        resolveIssueNumber: async () => {
          throw new IssueIdError('no issue id');
        }
      })
    );

    expect(result).toEqual({ mode: 'error', message: 'no issue id', exitCode: 2 });
  });

  it('returns an error result when config loading fails', async () => {
    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        loadVerificationConfig: async () => {
          throw new VerificationConfigError('config missing', '/repo/issueflow.config.json');
        }
      })
    );

    expect(result).toEqual({ mode: 'error', message: 'config missing', exitCode: 2 });
  });

  it('maps an aborted run to exit code 130', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {}, abortSignal: controller.signal },
      makeDeps({
        runRoute: async (input) => buildRun(input, { status: 'fail' })
      })
    );

    expect(result.mode).toBe('completed');
    if (result.mode === 'completed') {
      expect(result.exitCode).toBe(130);
    }
  });

  it('returns an error result with exit 2 when getRunDirectory fails', async () => {
    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        getRunDirectory: async () => {
          throw new Error('git rev-parse failed');
        }
      })
    );

    expect(result.mode).toBe('error');
    if (result.mode !== 'error') throw new Error('expected error mode');
    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/git rev-parse failed/);
  });

  it('writes a test report after a completed run', async () => {
    const calls: string[] = [];

    await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        writeTestReport: async (run) => {
          calls.push(run.runId);
          return '/repo/.git/issueflow/reports/issue-20/TEST_REPORT.md';
        }
      })
    );

    expect(calls).toEqual(['2026-06-01T10-00-00-000Z']);
  });

  it('does not write a test report for print-only runs', async () => {
    const calls: string[] = [];

    await createVerifyPlan(
      { cwd: '/cwd', options: { printOnly: true } },
      makeDeps({
        writeTestReport: async () => {
          calls.push('write');
          return null;
        }
      })
    );

    expect(calls).toEqual([]);
  });

  it('keeps the verify exit code when test report writing fails', async () => {
    const failingWrite = async () => {
      throw new Error('disk full');
    };

    const passResult = await createVerifyPlan({ cwd: '/cwd', options: {} }, makeDeps({ writeTestReport: failingWrite }));
    expect(passResult.mode).toBe('completed');
    if (passResult.mode === 'completed') {
      expect(passResult.exitCode).toBe(0);
    }

    const failResult = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        writeTestReport: failingWrite,
        runRoute: async (input) => buildRun(input, { status: 'fail', checks: [] })
      })
    );
    expect(failResult.mode).toBe('completed');
    if (failResult.mode === 'completed') {
      expect(failResult.exitCode).toBe(1);
    }
  });

  it('does not write a test report when verify returns error mode', async () => {
    const calls: string[] = [];

    await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        resolveIssueNumber: async () => {
          throw new IssueIdError('no issue id');
        },
        writeTestReport: async () => {
          calls.push('write');
          return null;
        }
      })
    );

    expect(calls).toEqual([]);
  });

  it('passes the resolved candidate branch and base branch through to the route', async () => {
    let capturedBranch: string | null = 'unset';
    let capturedBase: string | null = 'unset';

    await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        resolveCandidateBranch: async () => ({ branchName: 'candidate/99', baseBranch: 'develop' }),
        runRoute: async (input) => {
          capturedBranch = input.candidateBranch;
          capturedBase = input.baseBranch;
          return buildRun(input);
        }
      })
    );

    expect(capturedBranch).toBe('candidate/99');
    expect(capturedBase).toBe('develop');
  });
});
