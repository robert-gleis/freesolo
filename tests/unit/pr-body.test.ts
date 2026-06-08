import { describe, expect, it } from 'vitest';

import {
  buildPullRequestBody,
  buildPullRequestTitle,
  extractSummary
} from '../../src/integration/pr-body.js';
import type { VerificationRun } from '../../src/verification/types.js';

const sampleRun: VerificationRun = {
  schemaVersion: 1,
  runId: '20260608-120000',
  issueNumber: 43,
  repoRoot: '/repo',
  configPath: '/repo/issueflow.config.json',
  startedAt: '2026-06-08T12:00:00.000Z',
  finishedAt: '2026-06-08T12:00:05.000Z',
  status: 'pass',
  bail: false,
  checks: [
    {
      name: 'unit-tests',
      command: 'npm',
      args: ['test'],
      cwd: '/repo',
      status: 'pass',
      exitCode: 0,
      signal: null,
      startedAt: '2026-06-08T12:00:01.000Z',
      finishedAt: '2026-06-08T12:00:04.000Z',
      durationMs: 3000,
      logPath: 'unit-tests.log'
    }
  ]
};

describe('buildPullRequestTitle', () => {
  it('formats Issue #N: Title From Slug', () => {
    expect(buildPullRequestTitle(43, 'automated-pull-request-creation')).toBe(
      'Issue #43: Automated Pull Request Creation'
    );
  });
});

describe('extractSummary', () => {
  it('reads ## Summary section from spec markdown', () => {
    const spec = '# Design\n\n## Summary\n\nShip PR automation.\n\n## Goals\n\n...';
    expect(extractSummary({ specMarkdown: spec })).toBe('Ship PR automation.');
  });

  it('falls back to plan Goal line', () => {
    const plan = '# Plan\n\n**Goal:** Open PRs automatically.\n';
    expect(extractSummary({ planMarkdown: plan })).toBe('Open PRs automatically.');
  });

  it('uses issue fallback when no artifacts', () => {
    expect(extractSummary({ issueNumber: 43, issueSlug: 'automated-pr' })).toBe(
      'Automated changes for issue #43 (automated-pr).'
    );
  });
});

describe('buildPullRequestBody', () => {
  it('includes summary, test table, review, and Closes footer', () => {
    const body = buildPullRequestBody({
      issueNumber: 43,
      summary: 'Ship PR automation.',
      verificationRun: sampleRun,
      reviewMarkdown: '## Verdict\npass\n'
    });

    expect(body).toContain('## Summary');
    expect(body).toContain('Ship PR automation.');
    expect(body).toContain('## Test Results');
    expect(body).toContain('| unit-tests | pass | 3.0s |');
    expect(body).toContain('## Review Results');
    expect(body).toContain('## Verdict');
    expect(body).toContain('Closes #43');
  });
});
