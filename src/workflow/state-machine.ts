export const WORKFLOW_STATES = [
  'triaged',
  'planned',
  'approved',
  'implementing',
  'reviewing',
  'verifying',
  'pr-ready',
  'merged',
  'closed'
] as const;

export type WorkflowState = (typeof WORKFLOW_STATES)[number];

export const TRANSITIONS: Readonly<Record<WorkflowState, readonly WorkflowState[]>> = {
  triaged: ['planned'],
  planned: ['approved', 'triaged'],
  approved: ['implementing', 'planned'],
  implementing: ['reviewing', 'approved'],
  reviewing: ['verifying', 'implementing'],
  verifying: ['pr-ready', 'implementing'],
  'pr-ready': ['merged', 'implementing'],
  merged: ['closed'],
  closed: []
};

export class InvalidTransitionError extends Error {
  readonly from: WorkflowState;
  readonly to: WorkflowState;
  readonly allowedNext: readonly WorkflowState[];

  constructor(from: WorkflowState, to: WorkflowState, allowedNext: readonly WorkflowState[]) {
    const allowed = allowedNext.length > 0 ? allowedNext.join(', ') : '(terminal)';
    super(`Invalid workflow transition: ${from} → ${to}. Allowed from ${from}: ${allowed}.`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
    this.allowedNext = allowedNext;
  }
}

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  if (from === to) {
    return true;
  }

  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: WorkflowState, to: WorkflowState): void {
  if (canTransition(from, to)) {
    return;
  }

  throw new InvalidTransitionError(from, to, TRANSITIONS[from]);
}
