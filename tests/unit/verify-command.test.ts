import { describe, expect, it } from 'vitest';

import { createVerifyPlan, type VerifyPlanDeps } from '../../src/commands/verify.js';
import { IssueIdError } from '../../src/core/issue-id.js';
import { VerificationConfigError } from '../../src/verification/config.js';
import type { VerificationConfig, VerificationRun } from '../../src/verification/types.js';

function makeConfig(): VerificationConfig {
  return {
    verification: {
      checks: [
        { name: 'lint', command: 'lint-cmd', args: [], env: {} },
        { name: 'typecheck', command: 'tsc', args: ['--noEmit'], env: {} }
      ]
    }
  };
}

function makeDeps(overrides: Partial<VerifyPlanDeps> = {}): VerifyPlanDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    resolveIssueNumber: async (_repoRoot, override) => override ?? 20,
    loadVerificationConfig: async () => makeConfig(),
    getRunDirectory: async (_repoRoot, issueNumber, runId) =>
      `/repo/.git/issueflow/verifications/issue-${issueNumber}/${runId}`,
    runPipeline: async (input) => ({
      schemaVersion: 1 as const,
      runId: input.runId,
      issueNumber: input.issueNumber,
      repoRoot: input.repoRoot,
      configPath: input.configPath,
      startedAt: '2026-06-01T10:00:00.000Z',
      finishedAt: '2026-06-01T10:00:01.000Z',
      status: 'pass',
      bail: input.bail,
      checks: input.config.verification.checks.map((check) => ({
        name: check.name,
        command: check.command,
        args: check.args,
        cwd: input.repoRoot,
        status: 'pass',
        exitCode: 0,
        signal: null,
        startedAt: '2026-06-01T10:00:00.000Z',
        finishedAt: '2026-06-01T10:00:01.000Z',
        durationMs: 1000,
        logPath: `${input.runDirectory}/${check.name}.log`
      }))
    }),
    now: () => new Date('2026-06-01T10:00:00.000Z'),
    newRunId: () => '2026-06-01T10-00-00-000Z',
    ...overrides
  };
}

describe('createVerifyPlan', () => {
  it('returns a print-only result without invoking the runner', async () => {
    const calls: string[] = [];

    const result = await createVerifyPlan(
      { cwd: '/cwd', options: { printOnly: true } },
      makeDeps({
        runPipeline: async () => {
          calls.push('runPipeline');
          return undefined as unknown as VerificationRun;
        }
      })
    );

    expect(calls).toEqual([]);
    expect(result.mode).toBe('print-only');
    if (result.mode === 'print-only') {
      expect(result.summaryLines.join('\n')).toContain('lint');
      expect(result.summaryLines.join('\n')).toContain('typecheck');
      expect(result.summaryLines.join('\n')).toContain('issue-20');
    }
  });

  it('returns a completed run when the runner reports pass', async () => {
    const result = await createVerifyPlan({ cwd: '/cwd', options: {} }, makeDeps());

    expect(result.mode).toBe('completed');
    if (result.mode === 'completed') {
      expect(result.run.status).toBe('pass');
      expect(result.exitCode).toBe(0);
    }
  });

  it('returns a completed run with exit 1 when the runner reports fail', async () => {
    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        runPipeline: async (input) => ({
          schemaVersion: 1 as const,
          runId: input.runId,
          issueNumber: input.issueNumber,
          repoRoot: input.repoRoot,
          configPath: input.configPath,
          startedAt: '2026-06-01T10:00:00.000Z',
          finishedAt: '2026-06-01T10:00:01.000Z',
          status: 'fail',
          bail: input.bail,
          checks: []
        })
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
        runPipeline: async (input) => ({
          schemaVersion: 1 as const,
          runId: input.runId,
          issueNumber: input.issueNumber,
          repoRoot: input.repoRoot,
          configPath: input.configPath,
          startedAt: '2026-06-01T10:00:00.000Z',
          finishedAt: '2026-06-01T10:00:01.000Z',
          status: 'fail',
          bail: input.bail,
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
              logPath: `${input.runDirectory}/lint.log`
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

  it('maps an aborted-between-checks run to exit code 130', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await createVerifyPlan(
      { cwd: '/cwd', options: {}, abortSignal: controller.signal },
      makeDeps({
        runPipeline: async (input) => ({
          schemaVersion: 1 as const,
          runId: input.runId,
          issueNumber: input.issueNumber,
          repoRoot: input.repoRoot,
          configPath: input.configPath,
          startedAt: '2026-06-01T10:00:00.000Z',
          finishedAt: '2026-06-01T10:00:01.000Z',
          status: 'fail',
          bail: input.bail,
          checks: [
            {
              name: 'lint', command: 'lint-cmd', args: [], cwd: '/repo',
              status: 'pass', exitCode: 0, signal: null,
              startedAt: '2026-06-01T10:00:00.000Z', finishedAt: '2026-06-01T10:00:00.500Z',
              durationMs: 500, logPath: `${input.runDirectory}/lint.log`
            },
            {
              name: 'typecheck', command: 'tsc', args: ['--noEmit'], cwd: '/repo',
              status: 'skipped', exitCode: null, signal: null,
              startedAt: '2026-06-01T10:00:00.500Z', finishedAt: '2026-06-01T10:00:00.500Z',
              durationMs: 0, logPath: `${input.runDirectory}/typecheck.log`
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
        runPipeline: async (input) => ({
          schemaVersion: 1 as const,
          runId: input.runId,
          issueNumber: input.issueNumber,
          repoRoot: input.repoRoot,
          configPath: input.configPath,
          startedAt: '2026-06-01T10:00:00.000Z',
          finishedAt: '2026-06-01T10:00:01.000Z',
          status: 'fail',
          bail: input.bail,
          checks: []
        })
      })
    );
    expect(failResult.mode).toBe('completed');
    if (failResult.mode === 'completed') {
      expect(failResult.exitCode).toBe(1);
    }

    const sigintResult = await createVerifyPlan(
      { cwd: '/cwd', options: {} },
      makeDeps({
        writeTestReport: failingWrite,
        runPipeline: async (input) => ({
          schemaVersion: 1 as const,
          runId: input.runId,
          issueNumber: input.issueNumber,
          repoRoot: input.repoRoot,
          configPath: input.configPath,
          startedAt: '2026-06-01T10:00:00.000Z',
          finishedAt: '2026-06-01T10:00:01.000Z',
          status: 'fail',
          bail: input.bail,
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
              logPath: `${input.runDirectory}/lint.log`
            }
          ]
        })
      })
    );
    expect(sigintResult.mode).toBe('completed');
    if (sigintResult.mode === 'completed') {
      expect(sigintResult.exitCode).toBe(130);
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

  it('passes bail through to the pipeline', async () => {
    let captured = false;

    await createVerifyPlan(
      { cwd: '/cwd', options: { bail: true } },
      makeDeps({
        runPipeline: async (input) => {
          captured = input.bail;
          return {
            schemaVersion: 1 as const,
            runId: input.runId,
            issueNumber: input.issueNumber,
            repoRoot: input.repoRoot,
            configPath: input.configPath,
            startedAt: '2026-06-01T10:00:00.000Z',
            finishedAt: '2026-06-01T10:00:01.000Z',
            status: 'pass',
            bail: input.bail,
            checks: []
          };
        }
      })
    );

    expect(captured).toBe(true);
  });
});
