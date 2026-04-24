import { describe, expect, it } from 'vitest';

import { buildWorkflowKernel } from '../../src/workflow/kernel.js';

describe('buildWorkflowKernel', () => {
  it('contains the required stage order and review gates', () => {
    const kernel = buildWorkflowKernel({
      issueNumber: 12,
      issueTitle: 'Ship issueflow start',
      issueBody: 'Build the first working start command.',
      issueUrl: 'https://github.com/robert-gleis/issueflow/issues/12',
      branchName: 'issue/12-ship-issueflow-start',
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start'
    });

    expect(kernel).toContain('superpowers:brainstorming');
    expect(kernel).toContain('Review Gate 1');
    expect(kernel).toContain('superpowers:test-driven-development');
    expect(kernel).toContain('superpowers:verification-before-completion');
  });
});
