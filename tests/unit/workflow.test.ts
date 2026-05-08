import { describe, expect, it } from 'vitest';

import { buildIssuePacket, buildWorkflowKernel } from '../../src/workflow/kernel.js';

describe('buildIssuePacket', () => {
  it('includes the issue context needed for stage 1 intake', () => {
    const packet = buildIssuePacket({
      issueNumber: 12,
      issueTitle: 'Ship issueflow start',
      issueBody: 'Build the first working start command.',
      issueUrl: 'https://github.com/robert-gleis/issueflow/issues/12',
      labels: ['workflow', 'cli'],
      assignees: ['robert-gleis'],
      repoRoot: '/repo',
      branchName: 'issue/12-ship-issueflow-start',
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
      artifacts: {
        spec: '/repo/docs/issueflow/specs/2026-04-24-issue-12-design.md',
        plan: null,
        planReview: '/repo/docs/issueflow/reviews/2026-04-24-issue-12-plan-review.md',
        implementationReview: null
      }
    });

    expect(packet).toContain('## Labels');
    expect(packet).toContain('workflow, cli');
    expect(packet).toContain('## Assignees');
    expect(packet).toContain('robert-gleis');
    expect(packet).toContain('## Repo Root');
    expect(packet).toContain('/repo');
    expect(packet).toContain('## Existing Artifacts');
    expect(packet).toContain('/repo/docs/issueflow/specs/2026-04-24-issue-12-design.md');
    expect(packet).toContain('plan: not created yet');
  });
});

describe('buildWorkflowKernel', () => {
  it('contains the required stage order and review gates', () => {
    const kernel = buildWorkflowKernel({
      issueNumber: 12,
      issueTitle: 'Ship issueflow start',
      issueBody: 'Build the first working start command.',
      issueUrl: 'https://github.com/robert-gleis/issueflow/issues/12',
      labels: ['workflow'],
      assignees: ['robert-gleis'],
      repoRoot: '/repo',
      branchName: 'issue/12-ship-issueflow-start',
      worktreePath: '/tmp/issueflow-12-ship-issueflow-start',
      artifacts: {
        spec: null,
        plan: null,
        planReview: null,
        implementationReview: null
      }
    });

    expect(kernel).toContain('superpowers:brainstorming');
    expect(kernel).toContain('superpowers:test-driven-development');
    expect(kernel).toContain('superpowers:verification-before-completion');
    expect(kernel).toContain('Plan Review/Fix Loop');
    expect(kernel).toContain('Implementation Review/Fix Loop');
    expect(kernel).toContain('up to 5 rounds');
    expect(kernel).toContain('fresh reviewer agent');
    expect(kernel).toContain('separate fixer agent');
    expect(kernel).toContain('passes with no findings');
    expect(kernel).toContain('Do not proceed after round 5');
  });
});
