import { describe, expect, it } from 'vitest';

import { buildMergeReadinessComment } from '../../src/integration/merge-comment.js';

describe('buildMergeReadinessComment', () => {
  it('includes heading, table, and marker', () => {
    const body = buildMergeReadinessComment(
      {
        outcome: 'ready',
        reason: 'ok',
        nextAction: 'merge',
        checks: [
          { id: 'workflow-state', label: 'Workflow state', status: 'pass', detail: 'pr-ready' }
        ]
      },
      '2026-06-08T12:00:00.000Z'
    );

    expect(body).toContain('## FreeSolo Merge Readiness');
    expect(body).toContain('| Gate | Status | Detail |');
    expect(body).toContain('| Workflow state | pass | pr-ready |');
    expect(body).toContain('<!-- freesolo-merge-readiness -->');
  });
});
