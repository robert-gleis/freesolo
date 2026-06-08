import type { EventRecord } from '../event-log/types.js';
import { CANONICAL_STEPS, stepIndex, workflowStateToStepId } from './steps.js';
import type {
  Timeline,
  TimelineAttempt,
  TimelineStep,
  TimelineStepId,
  TimelineStepStatus
} from './types.js';

function createInitialSteps(): TimelineStep[] {
  return CANONICAL_STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    status: 'pending' as TimelineStepStatus,
    attempts: [],
    startedAt: null,
    completedAt: null
  }));
}

function getStepMap(steps: TimelineStep[]): Map<TimelineStepId, TimelineStep> {
  return new Map(steps.map((step) => [step.id, step]));
}

function recordAttempt(step: TimelineStep, attempt: TimelineAttempt): void {
  step.attempts.push(attempt);
}

function readTransitionPayload(payload: Record<string, unknown>): { from: string; to: string } | null {
  const from = payload.from;
  const to = payload.to;
  if (typeof from !== 'string' || typeof to !== 'string') {
    return null;
  }
  return { from, to };
}

function readRefusedPayload(payload: Record<string, unknown>): {
  fromState: string | null;
  reason: string;
} | null {
  const reason = payload.reason;
  if (typeof reason !== 'string') {
    return null;
  }
  const fromState = payload.fromState;
  return {
    fromState: typeof fromState === 'string' ? fromState : null,
    reason
  };
}

function readReviewGatePayload(payload: Record<string, unknown>): {
  status: string;
  gate: string;
  round: number;
} | null {
  const status = payload.status;
  const gate = payload.gate;
  const round = payload.round;
  if (typeof status !== 'string' || typeof gate !== 'string' || typeof round !== 'number') {
    return null;
  }
  return { status, gate, round };
}

function applyEvent(steps: TimelineStep[], event: EventRecord): void {
  const stepMap = getStepMap(steps);
  const at = event.createdAt;
  const attemptBase = { at, eventId: event.id };

  const completeStep = (stepId: TimelineStepId, detail?: string): void => {
    const step = stepMap.get(stepId);
    if (!step) {
      return;
    }
    recordAttempt(step, { ...attemptBase, status: 'completed', detail });
  };

  const failStep = (stepId: TimelineStepId, detail?: string): void => {
    const step = stepMap.get(stepId);
    if (!step) {
      return;
    }
    recordAttempt(step, { ...attemptBase, status: 'failed', detail });
  };

  switch (event.eventType) {
    case 'plan.approved':
    case 'team.planned':
      completeStep('planned');
      break;
    case 'workflow.transition': {
      const transition = readTransitionPayload(event.payload);
      if (!transition) {
        break;
      }
      const fromStep = workflowStateToStepId(transition.from);
      const toStep = workflowStateToStepId(transition.to);
      if (fromStep && toStep && stepIndex(fromStep) > stepIndex(toStep)) {
        failStep(fromStep, `regressed to ${transition.to}`);
      }
      if (toStep) {
        completeStep(toStep, `${transition.from} → ${transition.to}`);
      }
      break;
    }
    case 'workflow.refused': {
      const refused = readRefusedPayload(event.payload);
      if (!refused) {
        break;
      }
      let stepId = refused.fromState ? workflowStateToStepId(refused.fromState) : null;
      if (!stepId) {
        stepId = inferInProgressStepId(steps);
      }
      if (stepId) {
        failStep(stepId, refused.reason);
      }
      break;
    }
    case 'verification.failed':
      failStep('verified', typeof event.payload.detail === 'string' ? event.payload.detail : undefined);
      break;
    case 'verification.passed':
      completeStep('verified');
      break;
    case 'review.gate.completed': {
      const review = readReviewGatePayload(event.payload);
      if (!review) {
        break;
      }
      const detail = `round ${review.round}: ${review.status}`;
      if (review.status === 'pass') {
        completeStep('reviewed', detail);
      } else {
        failStep('reviewed', detail);
      }
      break;
    }
    case 'pr.created': {
      const branchName = typeof event.payload.branchName === 'string' ? event.payload.branchName : undefined;
      const url = typeof event.payload.url === 'string' ? event.payload.url : undefined;
      const detail = [branchName, url].filter(Boolean).join(' — ') || undefined;
      completeStep('pr-created', detail);
      break;
    }
    default:
      break;
  }
}

function inferInProgressStepId(steps: TimelineStep[]): TimelineStepId | null {
  let highestTouchedIndex = -1;
  let highestCompletedIndex = -1;

  for (const step of steps) {
    if (step.attempts.length > 0) {
      highestTouchedIndex = Math.max(highestTouchedIndex, stepIndex(step.id));
    }
    if (step.attempts.some((attempt) => attempt.status === 'completed')) {
      highestCompletedIndex = Math.max(highestCompletedIndex, stepIndex(step.id));
    }
  }

  if (highestTouchedIndex < 0) {
    return null;
  }

  const candidate = CANONICAL_STEPS[highestTouchedIndex]?.id ?? null;
  if (!candidate) {
    return null;
  }

  const candidateStep = steps.find((step) => step.id === candidate);
  if (candidateStep?.attempts.at(-1)?.status === 'completed') {
    return highestCompletedIndex >= 0
      ? (CANONICAL_STEPS[Math.min(highestTouchedIndex + 1, CANONICAL_STEPS.length - 1)]?.id ?? null)
      : candidate;
  }

  return candidate;
}

function deriveStepFields(steps: TimelineStep[]): void {
  let highestTouchedIndex = -1;
  for (const step of steps) {
    if (step.attempts.length > 0) {
      highestTouchedIndex = Math.max(highestTouchedIndex, stepIndex(step.id));
    }
  }

  let highestCompletedIndex = -1;
  for (const step of steps) {
    const lastAttempt = step.attempts.at(-1);
    step.startedAt = step.attempts[0]?.at ?? null;
    step.completedAt =
      [...step.attempts].reverse().find((attempt) => attempt.status === 'completed')?.at ?? null;

    if (lastAttempt?.status === 'completed') {
      highestCompletedIndex = Math.max(highestCompletedIndex, stepIndex(step.id));
      step.status = 'completed';
      continue;
    }

    if (step.attempts.length === 0) {
      step.status = 'pending';
      continue;
    }

    if (lastAttempt?.status === 'failed' && highestCompletedIndex < stepIndex(step.id)) {
      if (
        stepIndex(step.id) === highestTouchedIndex &&
        step.attempts.some((attempt) => attempt.status === 'completed')
      ) {
        step.status = 'in_progress';
        continue;
      }
      step.status = 'failed';
      continue;
    }

    if (stepIndex(step.id) === highestTouchedIndex) {
      step.status = 'in_progress';
      continue;
    }

    step.status = step.attempts.length > 0 ? 'in_progress' : 'pending';
  }
}

export function buildTimeline(issueNumber: number, events: EventRecord[]): Timeline {
  const steps = createInitialSteps();
  const sorted = [...events].sort((left, right) => left.id - right.id);

  for (const event of sorted) {
    applyEvent(steps, event);
  }

  deriveStepFields(steps);

  const hasActivity = steps.some((step) => step.attempts.length > 0);

  return {
    issueNumber,
    steps,
    hasActivity
  };
}
