import { describe, expect, it } from 'vitest';

import { gateEvaluateAction, type GateCommandDeps } from '../../src/commands/gate.js';
import type { VerificationRun } from '../../src/verification/types.js';
import { MultipleVerdictLabelsError, type GateVerdictRecord, type VerdictStatus } from '../../src/verification/verdict-store.js';
import type { WorkflowState } from '../../src/workflow/state-machine.js';
import type { RepoRef } from '../../src/core/types.js';

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
