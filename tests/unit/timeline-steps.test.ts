import { describe, expect, it } from 'vitest';

import { CANONICAL_STEPS, stepIndex, workflowStateToStepId } from '../../src/timeline/steps.js';

describe('timeline steps', () => {
  it('orders canonical steps Planned through PR Created', () => {
    expect(CANONICAL_STEPS.map((step) => step.id)).toEqual([
      'planned',
      'implemented',
      'reviewed',
      'verified',
      'pr-created'
    ]);
  });

  it('maps workflow states to step ids', () => {
    expect(workflowStateToStepId('planned')).toBe('planned');
    expect(workflowStateToStepId('approved')).toBe('planned');
    expect(workflowStateToStepId('implementing')).toBe('implemented');
    expect(workflowStateToStepId('reviewing')).toBe('reviewed');
    expect(workflowStateToStepId('verifying')).toBe('verified');
    expect(workflowStateToStepId('pr-ready')).toBe('pr-created');
  });

  it('returns null for unmapped states', () => {
    expect(workflowStateToStepId('triaged')).toBeNull();
    expect(workflowStateToStepId('closed')).toBeNull();
  });

  it('compares step indices for retry detection', () => {
    expect(stepIndex('verified')).toBeGreaterThan(stepIndex('implemented'));
  });
});
