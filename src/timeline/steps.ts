import type { TimelineStepId } from './types.js';

export interface CanonicalStep {
  id: TimelineStepId;
  label: string;
}

export const CANONICAL_STEPS: readonly CanonicalStep[] = [
  { id: 'planned', label: 'Planned' },
  { id: 'implemented', label: 'Implemented' },
  { id: 'reviewed', label: 'Reviewed' },
  { id: 'verified', label: 'Verified' },
  { id: 'pr-created', label: 'PR Created' }
];

const WORKFLOW_STATE_TO_STEP: Record<string, TimelineStepId> = {
  planned: 'planned',
  approved: 'planned',
  implementing: 'implemented',
  reviewing: 'reviewed',
  verifying: 'verified',
  'pr-ready': 'pr-created'
};

export function workflowStateToStepId(state: string): TimelineStepId | null {
  return WORKFLOW_STATE_TO_STEP[state] ?? null;
}

export function stepIndex(id: TimelineStepId): number {
  return CANONICAL_STEPS.findIndex((step) => step.id === id);
}
