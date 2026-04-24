import { describe, expect, it } from 'vitest';

import { sessionStateSchema } from '../../src/core/session-state.js';

describe('sessionStateSchema', () => {
  it('accepts the persisted issueflow state shape', () => {
    const parsed = sessionStateSchema.parse({
      issueNumber: 12,
      issueSlug: 'ship-issueflow-start',
      branchName: 'issue/12-ship-issueflow-start',
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
      chosenHost: 'codex',
      currentStage: 'brainstorming',
      artifacts: {
        spec: null,
        plan: null,
        planReview: null,
        implementationReview: null
      }
    });

    expect(parsed.currentStage).toBe('brainstorming');
  });
});
