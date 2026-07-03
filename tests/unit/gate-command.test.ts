import { describe, expect, it } from 'vitest';

import { gateEvaluateAction, type GateCommandDeps } from '../../src/commands/gate.js';
import type { GateRouteRun, RunStatus, VerificationRun } from '../../src/verification/types.js';
import { MultipleVerdictLabelsError, type GateVerdictRecord, type VerdictStatus } from '../../src/verification/verdict-store.js';
import type { WorkflowState } from '../../src/workflow/state-machine.js';
import type { RepoRef } from '../../src/workflow/state-store.js';

const repo: RepoRef = { owner: 'acme', repo: 'widgets' };

function makePassRun(): VerificationRun {
  return {
    schemaVersion: 1,
    runId: '2026-06-01T08-00-00-000Z',
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

function makeFailRun(): VerificationRun {
  return { ...makePassRun(), status: 'fail' };
}

const ROUTE_RUN_ID = '2026-07-03T09-15-00-000Z';

/**
 * A full Gate Route run record (schemaVersion 2) as written by runGateRoute — the
 * actual shape loadLatestRun returns in production. gate evaluate must treat this
 * as authoritative, recording the ROUTE run id in the GateVerdictRecord.
 */
function makeRouteRun(status: RunStatus): GateRouteRun {
  return {
    schemaVersion: 2,
    runId: ROUTE_RUN_ID,
    issueNumber: 29,
    repoRoot: '/repo',
    configPath: '/repo/issueflow.config.json',
    startedAt: '2026-07-03T09:15:00.000Z',
    finishedAt: '2026-07-03T09:20:00.000Z',
    status,
    bail: true,
    checks: [
      {
        name: 'build',
        command: 'npm',
        args: ['run', 'build'],
        cwd: '/repo',
        status: status === 'pass' ? 'pass' : 'fail',
        exitCode: status === 'pass' ? 0 : 1,
        signal: null,
        startedAt: '2026-07-03T09:15:00.000Z',
        finishedAt: '2026-07-03T09:16:00.000Z',
        durationMs: 60000,
        logPath: '/repo/.git/issueflow/verifications/issue-29/attempt-1-build.log'
      }
    ],
    candidateBranch: 'candidate/29-native-gate-route',
    routeConfigPath: '/repo/issueflow.config.json',
    maxAttempts: 3,
    attemptsUsed: 1,
    attempts: [
      {
        attempt: 1,
        status,
        checks: [
          {
            name: 'build',
            kind: 'shell',
            status: status === 'pass' ? 'pass' : 'fail',
            command: 'npm',
            exitCode: status === 'pass' ? 0 : 1,
            signal: null,
            startedAt: '2026-07-03T09:15:00.000Z',
            finishedAt: '2026-07-03T09:16:00.000Z',
            durationMs: 60000,
            logPath: '/repo/.git/issueflow/verifications/issue-29/attempt-1-build.log'
          }
        ]
      }
    ],
    reviewArtifactPaths: [],
    fixerInvocations: []
  };
}

function makeDeps(overrides: Partial<GateCommandDeps> = {}): GateCommandDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    resolveRepoRef: async () => repo,
    resolveIssueNumber: async () => 29,
    readState: async () => 'verifying',
    writeState: async () => {},
    readVerdict: async () => null,
    writeVerdict: async () => {},
    loadLatestRun: async () => makePassRun(),
    writeGateVerdictRecord: async () => {},
    env: { ISSUEFLOW_ENGINE: '1' },
    write: () => {},
    setExitCode: () => {},
    now: () => new Date('2026-06-01T08:02:00.000Z'),
    ...overrides
  };
}

describe('gateEvaluateAction', () => {
  it('exits 3 when ISSUEFLOW_ENGINE is not set', async () => {
    let exitCode = 0;
    const output: string[] = [];

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        env: {},
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (_channel, msg) => output.push(msg)
      })
    );

    expect(exitCode).toBe(3);
    expect(output.join('')).toMatch(/engine-only/i);
  });

  it('exits 2 when current state is not verifying', async () => {
    let exitCode = 0;

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        readState: async (): Promise<WorkflowState | null> => 'implementing',
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );

    expect(exitCode).toBe(2);
  });

  it('exits 2 on no-run without writing verdict or state', async () => {
    let exitCode = 0;
    const verdictCalls: string[] = [];
    const stateCalls: string[] = [];

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        loadLatestRun: async () => null,
        writeVerdict: async () => {
          verdictCalls.push('writeVerdict');
        },
        writeState: async () => {
          stateCalls.push('writeState');
        },
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );

    expect(exitCode).toBe(2);
    expect(verdictCalls).toEqual([]);
    expect(stateCalls).toEqual([]);
  });

  it('writes verdict pass, transitions to pr-ready, exits 0 on passing run', async () => {
    let exitCode = 99;
    let capturedTo: WorkflowState | null = null;
    let capturedVerdict: VerdictStatus | null = null;
    let capturedRecord: GateVerdictRecord | null = null;

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        writeState: async (_r, _n, _from, to) => {
          capturedTo = to;
        },
        writeVerdict: async (_r, _n, _from, to) => {
          capturedVerdict = to;
        },
        writeGateVerdictRecord: async (_root, _n, record) => {
          capturedRecord = record;
        },
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );

    expect(capturedTo).toBe('pr-ready');
    expect(capturedVerdict).toBe('pass');
    expect(capturedRecord?.outcome).toBe('pass');
    expect(capturedRecord?.runId).toBe('2026-06-01T08-00-00-000Z');
    expect(capturedRecord?.evaluatedAt).toBe('2026-06-01T08:02:00.000Z');
    expect(exitCode).toBe(0);
  });

  it('writes verdict fail, transitions to implementing, exits 1 on failing run', async () => {
    let exitCode = 99;
    let capturedTo: WorkflowState | null = null;
    let capturedVerdict: VerdictStatus | null = null;
    const stderr: string[] = [];

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        loadLatestRun: async () => makeFailRun(),
        writeState: async (_r, _n, _from, to) => {
          capturedTo = to;
        },
        writeVerdict: async (_r, _n, _from, to) => {
          capturedVerdict = to;
        },
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (channel, msg) => {
          if (channel === 'stderr') {
            stderr.push(msg);
          }
        }
      })
    );

    expect(capturedTo).toBe('implementing');
    expect(capturedVerdict).toBe('fail');
    expect(exitCode).toBe(1);
    expect(stderr.join('')).toContain('issueflow verify');
  });

  it('records the ROUTE run id and transitions to pr-ready on a passing GateRouteRun', async () => {
    let exitCode = 99;
    let capturedTo: WorkflowState | null = null;
    let capturedFrom: WorkflowState | null = null;
    let capturedVerdict: VerdictStatus | null = null;
    let capturedRecord: GateVerdictRecord | null = null;

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        loadLatestRun: async () => makeRouteRun('pass'),
        writeState: async (_r, _n, from, to) => {
          capturedFrom = from;
          capturedTo = to;
        },
        writeVerdict: async (_r, _n, _from, to) => {
          capturedVerdict = to;
        },
        writeGateVerdictRecord: async (_root, _n, record) => {
          capturedRecord = record;
        },
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );

    expect(capturedVerdict).toBe('pass');
    expect(capturedRecord?.outcome).toBe('pass');
    // The verdict record must point at the ROUTE run id, so pr create's
    // stale-verdict guard can compare it against the latest route run.
    expect(capturedRecord?.runId).toBe(ROUTE_RUN_ID);
    expect(capturedFrom).toBe('verifying');
    expect(capturedTo).toBe('pr-ready');
    expect(exitCode).toBe(0);
  });

  it('records the ROUTE run id and transitions to implementing on a failing GateRouteRun', async () => {
    let exitCode = 99;
    let capturedTo: WorkflowState | null = null;
    let capturedFrom: WorkflowState | null = null;
    let capturedVerdict: VerdictStatus | null = null;
    let capturedRecord: GateVerdictRecord | null = null;

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        loadLatestRun: async () => makeRouteRun('fail'),
        writeState: async (_r, _n, from, to) => {
          capturedFrom = from;
          capturedTo = to;
        },
        writeVerdict: async (_r, _n, _from, to) => {
          capturedVerdict = to;
        },
        writeGateVerdictRecord: async (_root, _n, record) => {
          capturedRecord = record;
        },
        setExitCode: (code) => {
          exitCode = code;
        }
      })
    );

    expect(capturedVerdict).toBe('fail');
    expect(capturedRecord?.outcome).toBe('fail');
    expect(capturedRecord?.runId).toBe(ROUTE_RUN_ID);
    expect(capturedFrom).toBe('verifying');
    expect(capturedTo).toBe('implementing');
    expect(exitCode).toBe(1);
  });

  it('exits 4 when readVerdict throws MultipleVerdictLabelsError', async () => {
    let exitCode = 99;
    const stderr: string[] = [];

    await gateEvaluateAction(
      { issue: undefined },
      makeDeps({
        readVerdict: async () => {
          throw new MultipleVerdictLabelsError(29, ['verification:pass', 'verification:fail']);
        },
        setExitCode: (code) => {
          exitCode = code;
        },
        write: (channel, msg) => {
          if (channel === 'stderr') {
            stderr.push(msg);
          }
        }
      })
    );

    expect(exitCode).toBe(4);
    expect(stderr.join('')).toMatch(/multiple/i);
  });
});
