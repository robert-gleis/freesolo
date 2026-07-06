import { describe, expect, it } from 'vitest';

import { evaluateGate } from '../../src/verification/gate.js';
import type { VerificationRun } from '../../src/verification/types.js';

function makeRun(status: 'pass' | 'fail'): VerificationRun {
  return {
    schemaVersion: 1,
    runId: '2026-06-01T08-00-00-000Z',
    issueNumber: 29,
    repoRoot: '/repo',
    configPath: '/repo/freesolo.config.json',
    startedAt: '2026-06-01T08:00:00.000Z',
    finishedAt: '2026-06-01T08:01:00.000Z',
    status,
    bail: false,
    checks: []
  };
}

describe('evaluateGate', () => {
  it('returns no-run when there is no verification run', () => {
    const result = evaluateGate(null);
    expect(result.outcome).toBe('no-run');
    expect(result.runId).toBeNull();
    expect(result.nextAction).toContain('freesolo verify');
  });

  it('returns pass when the latest run passed', () => {
    const result = evaluateGate(makeRun('pass'));
    expect(result.outcome).toBe('pass');
    expect(result.runId).toBe('2026-06-01T08-00-00-000Z');
    expect(result.nextAction).toContain('freesolo pr create');
  });

  it('returns fail when the latest run failed', () => {
    const result = evaluateGate(makeRun('fail'));
    expect(result.outcome).toBe('fail');
    expect(result.nextAction).toContain('freesolo verify');
    expect(result.nextAction).toContain('gate evaluate');
  });
});
