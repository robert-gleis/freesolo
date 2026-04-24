import { describe, expect, it } from 'vitest';

import { sessionStateSchema } from '../../src/core/session-state.js';

describe('sessionStateSchema', () => {
  it('accepts the persisted issueflow state shape', () => {
    const parsed = sessionStateSchema.parse({
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
    });

    expect(parsed.currentStage).toBe('brainstorming');
    expect(parsed.reviewGates.plan).toBe('pending');
  });
});
