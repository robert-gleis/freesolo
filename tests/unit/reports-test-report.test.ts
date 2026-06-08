import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildTestReportMarkdown, formatDurationMs } from '../../src/reports/test-report.js';
import type { VerificationRun } from '../../src/verification/types.js';

function makeRun(overrides: Partial<VerificationRun> = {}): VerificationRun {
  const runDirectory = '/repo/.git/issueflow/verifications/issue-30/2026-06-08T12-00-00-000Z';

  return {
    schemaVersion: 1,
    runId: '2026-06-08T12-00-00-000Z',
    issueNumber: 30,
    repoRoot: '/repo',
    configPath: '/repo/issueflow.config.json',
    startedAt: '2026-06-08T12:00:00.000Z',
    finishedAt: '2026-06-08T12:05:00.000Z',
    status: 'fail',
    bail: false,
    checks: [
      {
        name: 'lint',
        command: 'npm',
        args: ['run', 'lint'],
        cwd: '/repo',
        status: 'pass',
        exitCode: 0,
        signal: null,
        startedAt: '2026-06-08T12:00:00.000Z',
        finishedAt: '2026-06-08T12:01:00.000Z',
        durationMs: 1500,
        logPath: path.join(runDirectory, 'lint.log')
      },
      {
        name: 'typecheck',
        command: 'npm',
        args: ['run', 'typecheck'],
        cwd: '/repo',
        status: 'pass',
        exitCode: 0,
        signal: null,
        startedAt: '2026-06-08T12:01:00.000Z',
        finishedAt: '2026-06-08T12:02:00.000Z',
        durationMs: 1000,
        logPath: path.join(runDirectory, 'typecheck.log')
      },
      {
        name: 'unit-tests',
        command: 'npm',
        args: ['test'],
        cwd: '/repo',
        status: 'fail',
        exitCode: 1,
        signal: null,
        startedAt: '2026-06-08T12:02:00.000Z',
        finishedAt: '2026-06-08T12:05:00.000Z',
        durationMs: 3000,
        logPath: path.join(runDirectory, 'unit-tests.log')
      }
    ],
    ...overrides
  };
}

describe('formatDurationMs', () => {
  it('formats milliseconds as seconds', () => {
    expect(formatDurationMs(1500)).toBe('1.5s');
  });
});

describe('buildTestReportMarkdown', () => {
  it('builds frontmatter, checks table, and run metadata for a mixed run', () => {
    const run = makeRun();
    const markdown = buildTestReportMarkdown(run, '2026-06-08T12:06:00.000Z');

    expect(markdown).toContain('kind: test-report');
    expect(markdown).toContain('schemaVersion: 1');
    expect(markdown).toContain('passedCount: 2');
    expect(markdown).toContain('failedCount: 1');
    expect(markdown).toContain('# Test Report — Issue #30');
    expect(markdown).toContain('| lint | pass | 1.5s |');
    expect(markdown).toContain('`lint.log`');
    expect(markdown).toContain('## Run metadata');
    expect(markdown).toContain('2026-06-08T12:00:00.000Z');
    expect(markdown).toContain('2026-06-08T12:05:00.000Z');
  });

  it('writes a fail report for a SIGINT-cancelled run', () => {
    const run = makeRun({
      status: 'fail',
      checks: [
        {
          name: 'lint',
          command: 'npm',
          args: ['run', 'lint'],
          cwd: '/repo',
          status: 'fail',
          exitCode: null,
          signal: 'SIGINT',
          startedAt: '2026-06-08T12:00:00.000Z',
          finishedAt: '2026-06-08T12:00:30.000Z',
          durationMs: 30000,
          logPath: '/repo/.git/issueflow/verifications/issue-30/run/lint.log'
        },
        {
          name: 'typecheck',
          command: 'npm',
          args: ['run', 'typecheck'],
          cwd: '/repo',
          status: 'skipped',
          exitCode: null,
          signal: null,
          startedAt: '2026-06-08T12:00:30.000Z',
          finishedAt: '2026-06-08T12:00:30.000Z',
          durationMs: 0,
          logPath: '/repo/.git/issueflow/verifications/issue-30/run/typecheck.log'
        }
      ]
    });

    const markdown = buildTestReportMarkdown(run, '2026-06-08T12:06:00.000Z');

    expect(markdown).toContain('status: fail');
    expect(markdown).toContain('| lint | fail |');
    expect(markdown).toContain('SIGINT');
    expect(markdown).toContain('| typecheck | skipped |');
  });
});
