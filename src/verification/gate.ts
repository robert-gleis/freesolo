import type { VerificationRun } from './types.js';

export type GateOutcome = 'pass' | 'fail' | 'no-run';

export interface GateEvaluation {
  outcome: GateOutcome;
  runId: string | null;
  reason: string;
  nextAction: string;
}

export function evaluateGate(latestRun: VerificationRun | null): GateEvaluation {
  if (!latestRun) {
    return {
      outcome: 'no-run',
      runId: null,
      reason: 'No verification run exists for this issue.',
      nextAction: 'Run `freesolo verify` for this issue, then `freesolo gate evaluate`.'
    };
  }

  if (latestRun.status === 'pass') {
    return {
      outcome: 'pass',
      runId: latestRun.runId,
      reason: `Verification run ${latestRun.runId} passed.`,
      nextAction: 'Create a pull request with `freesolo pr create`.'
    };
  }

  return {
    outcome: 'fail',
    runId: latestRun.runId,
    reason: `Verification run ${latestRun.runId} failed.`,
    nextAction: 'Fix failing checks, run `freesolo verify`, then `freesolo gate evaluate`.'
  };
}
