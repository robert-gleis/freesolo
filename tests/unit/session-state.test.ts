import { describe, expect, it } from 'vitest';

import { sessionStateSchema } from '../../src/core/session-state.js';

const baseState = {
  issueNumber: 12,
  issueSlug: 'ship-issueflow-start',
  repoRoot: '/repo',
  branchName: 'issue/12-ship-issueflow-start',
  worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
  chosenHost: 'codex',
  currentStage: 'brainstorming',
  reviewGates: {
    plan: 'pending',
    implementation: 'pass'
  },
  createdAt: '2026-04-24T10:00:00.000Z',
  updatedAt: '2026-04-24T11:30:00.000Z',
  artifacts: {
    spec: null,
    plan: null,
    planReview: null,
    implementationReview: null
  }
};

describe('sessionStateSchema', () => {
  it('accepts the persisted issueflow state shape with review loops', () => {
    const parsed = sessionStateSchema.parse({
      ...baseState,
      reviewLoops: {
        plan: {
          currentRound: 2,
          maxRounds: 5
        },
        implementation: {
          currentRound: 1,
          maxRounds: 5
        }
      }
    });

    expect(parsed.currentStage).toBe('brainstorming');
    expect(parsed.reviewGates.plan).toBe('pending');
    expect(parsed.reviewLoops.plan.currentRound).toBe(2);
    expect(parsed.reviewLoops.implementation.maxRounds).toBe(5);
  });

  it('defaults review loops for existing session files', () => {
    const parsed = sessionStateSchema.parse(baseState);

    expect(parsed.reviewLoops).toEqual({
      plan: {
        currentRound: 1,
        maxRounds: 5
      },
      implementation: {
        currentRound: 1,
        maxRounds: 5
      }
    });
  });
});
