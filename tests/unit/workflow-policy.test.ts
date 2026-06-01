import { describe, expect, it } from 'vitest';

import { WORKFLOW_STATES, type WorkflowState } from '../../src/workflow/state-machine.js';
import { defaultPolicy, type EngineAction } from '../../src/workflow/policy.js';

const repo = { owner: 'acme', repo: 'widgets' };

describe('defaultPolicy', () => {
  it('auto-transitions from merged to closed', () => {
    const action = defaultPolicy({ state: 'merged', issueNumber: 1, repo });
    expect(action).toEqual<EngineAction>({ kind: 'transition', to: 'closed' });
  });

  it('returns wait for every non-terminal, non-merged state', () => {
    const waitingStates: WorkflowState[] = [
      'triaged',
      'planned',
      'approved',
      'implementing',
      'reviewing',
      'verifying',
      'pr-ready'
    ];

    for (const state of waitingStates) {
      const action = defaultPolicy({ state, issueNumber: 1, repo });
      expect(action.kind).toBe('wait');
    }
  });

  it('returns wait for the closed state too (engine short-circuits before policy is called)', () => {
    const action = defaultPolicy({ state: 'closed', issueNumber: 1, repo });
    expect(action.kind).toBe('wait');
  });

  it('is total — every WORKFLOW_STATES entry produces an EngineAction', () => {
    for (const state of WORKFLOW_STATES) {
      const action = defaultPolicy({ state, issueNumber: 1, repo });
      expect(['transition', 'wait', 'spawn', 'refuse']).toContain(action.kind);
    }
  });
});
