import { describe, expect, it } from 'vitest';

import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  TRANSITIONS,
  WORKFLOW_STATES,
  type WorkflowState
} from '../../src/workflow/state-machine.js';

describe('WORKFLOW_STATES', () => {
  it('lists the nine canonical states in order', () => {
    expect(WORKFLOW_STATES).toEqual([
      'triaged',
      'planned',
      'approved',
      'implementing',
      'reviewing',
      'verifying',
      'pr-ready',
      'merged',
      'closed'
    ]);
  });
});

describe('canTransition', () => {
  const allowedPairs: Array<[WorkflowState, WorkflowState]> = [
    ['triaged', 'planned'],
    ['planned', 'approved'],
    ['planned', 'triaged'],
    ['approved', 'implementing'],
    ['approved', 'planned'],
    ['implementing', 'reviewing'],
    ['implementing', 'approved'],
    ['reviewing', 'verifying'],
    ['reviewing', 'implementing'],
    ['verifying', 'pr-ready'],
    ['verifying', 'implementing'],
    ['pr-ready', 'merged'],
    ['pr-ready', 'implementing'],
    ['merged', 'closed']
  ];

  it.each(allowedPairs)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('allows every self-transition as a no-op', () => {
    for (const state of WORKFLOW_STATES) {
      expect(canTransition(state, state)).toBe(true);
    }
  });

  it('rejects transitions out of the terminal closed state', () => {
    for (const target of WORKFLOW_STATES) {
      if (target === 'closed') continue;
      expect(canTransition('closed', target)).toBe(false);
    }
  });

  it('rejects a representative invalid skip', () => {
    expect(canTransition('triaged', 'implementing')).toBe(false);
    expect(canTransition('planned', 'merged')).toBe(false);
    expect(canTransition('reviewing', 'closed')).toBe(false);
  });

  it('exports TRANSITIONS as the source of truth keyed by every state', () => {
    for (const state of WORKFLOW_STATES) {
      expect(TRANSITIONS[state]).toBeDefined();
    }
  });
});

describe('assertTransition', () => {
  it('returns void for allowed transitions', () => {
    expect(() => assertTransition('triaged', 'planned')).not.toThrow();
  });

  it('returns void for self-transitions', () => {
    expect(() => assertTransition('implementing', 'implementing')).not.toThrow();
  });

  it('throws InvalidTransitionError naming from, to, and allowed-next', () => {
    let captured: unknown;

    try {
      assertTransition('triaged', 'merged');
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidTransitionError);
    const err = captured as InvalidTransitionError;
    expect(err.from).toBe('triaged');
    expect(err.to).toBe('merged');
    expect(err.allowedNext).toEqual(['planned']);
    expect(err.message).toBe(
      'Invalid workflow transition: triaged → merged. Allowed from triaged: planned.'
    );
  });

  it('formats a terminal-state error clearly', () => {
    let captured: unknown;

    try {
      assertTransition('closed', 'triaged');
    } catch (error) {
      captured = error;
    }

    expect(captured).toBeInstanceOf(InvalidTransitionError);
    expect((captured as InvalidTransitionError).message).toBe(
      'Invalid workflow transition: closed → triaged. Allowed from closed: (terminal).'
    );
  });
});
