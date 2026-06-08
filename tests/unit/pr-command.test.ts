import { describe, expect, it } from 'vitest';

import { assertPrGate, prCreateAction, type PrCommandDeps } from '../../src/commands/pr.js';
import type { VerificationRun } from '../../src/verification/types.js';
import { MultipleVerdictLabelsError } from '../../src/verification/verdict-store.js';
import type { RepoRef } from '../../src/workflow/state-store.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
const RUN_ID = '2026-06-01T08-00-00-000Z';

function makePassRun(): VerificationRun {
  return {
    schemaVersion: 1,
    runId: RUN_ID,
    issueNumber: 29,
    repoRoot: '/repo',
    configPath: '/repo/issueflow.config.json',
    startedAt: '2026-06-01T08:00:00.000Z',
    finishedAt: '2026-06-01T08:01:00.000Z',
    status: 'pass',
    bail: false,
    checks: []
  };
}

function makeDeps(overrides: Partial<PrCommandDeps> = {}): PrCommandDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    resolveRepoRef: async () => repo,
    resolveIssueNumber: async () => 29,
    readState: async () => 'pr-ready',
    readVerdict: async () => 'pass',
    loadLatestRun: async () => makePassRun(),
    readGateVerdictRecord: async () => ({
      schemaVersion: 1 as const,
      issueNumber: 29,
      runId: RUN_ID,
      outcome: 'pass' as const,
      reason: 'Verification run passed.',
      nextAction: 'Create a pull request.',
      evaluatedAt: '2026-06-01T08:02:00.000Z'
    }),
    spawnGhPrCreate: async () => {},
    write: () => {},
    setExitCode: () => {},
    ...overrides
  };
}

describe('assertPrGate', () => {
  it('returns ok when state is pr-ready, verdict is pass, and runId matches', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: makePassRun(),
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(true);
  });

  it('returns not-ok when state is not pr-ready', () => {
    const result = assertPrGate({
      state: 'implementing',
      verdict: 'pass',
      latestRun: makePassRun(),
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/pr-ready/);
  });

  it('returns not-ok when verdict is not pass', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: null,
      latestRun: makePassRun(),
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
  });

  it('returns not-ok when latest run is fail', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: { ...makePassRun(), status: 'fail' },
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
  });

  it('returns not-ok when storedRunId is null (missing local gate record)', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: makePassRun(),
      storedRunId: null
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/gate verdict record/i);
  });

  it('returns not-ok when storedRunId does not match latestRun.runId (stale pass)', () => {
    const result = assertPrGate({
      state: 'pr-ready',
      verdict: 'pass',
      latestRun: { ...makePassRun(), runId: 'newer-run-id' },
      storedRunId: RUN_ID
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/stale/i);
  });
});

describe('prCreateAction', () => {
  it('exits 1 and reports reason when gate check fails (state not pr-ready)', async () => {
    let exitCode = 99;
    const output: string[] = [];

    await prCreateAction(
      { issue: undefined, printOnly: false },
      [],
      makeDeps({
        readState: async () => 'implementing',
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(exitCode).toBe(1);
    expect(output.join('')).toMatch(/pr-ready/);
  });

  it('reports would-pass and exits 0 when --print-only and gate passes', async () => {
    let exitCode = 99;
    const ghCalls: string[] = [];
    const output: string[] = [];

    await prCreateAction(
      { issue: undefined, printOnly: true },
      [],
      makeDeps({
        spawnGhPrCreate: async () => {
          ghCalls.push('called');
        },
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(ghCalls).toEqual([]);
    expect(exitCode).toBe(0);
    expect(output.join('')).toMatch(/pass/i);
  });

  it('forwards extra args to gh pr create on happy path', async () => {
    const capturedArgs: string[] = [];

    await prCreateAction(
      { issue: undefined, printOnly: false },
      ['--title', 'My PR', '--body', 'Description'],
      makeDeps({
        spawnGhPrCreate: async (args) => {
          capturedArgs.push(...args);
        }
      })
    );

    expect(capturedArgs).toContain('--title');
    expect(capturedArgs).toContain('My PR');
    expect(capturedArgs).toContain('--body');
  });

  it('exits 4 when readVerdict throws MultipleVerdictLabelsError', async () => {
    let exitCode = 99;
    const output: string[] = [];

    await prCreateAction(
      { issue: undefined, printOnly: false },
      [],
      makeDeps({
        readVerdict: async () => {
          throw new MultipleVerdictLabelsError(29, ['verification:pass', 'verification:fail']);
        },
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(exitCode).toBe(4);
    expect(output.join('')).toMatch(/multiple/i);
  });
});
