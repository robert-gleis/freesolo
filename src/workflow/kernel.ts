import type { IssueArtifactPaths } from '../core/types.js';

export interface WorkflowKernelInput {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueUrl: string;
  labels: string[];
  assignees: string[];
  repoRoot: string;
  branchName: string;
  worktreePath: string;
  artifacts: IssueArtifactPaths;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

export function buildIssuePacket(input: WorkflowKernelInput): string {
  return `# Issue #${input.issueNumber}: ${input.issueTitle}

## URL
${input.issueUrl}

## Labels
${formatList(input.labels)}

## Assignees
${formatList(input.assignees)}

## Repo Root
${input.repoRoot}

## Branch
${input.branchName}

## Worktree
${input.worktreePath}

## Existing Artifacts
spec: ${input.artifacts.spec ?? 'not created yet'}
plan: ${input.artifacts.plan ?? 'not created yet'}
planReview: ${input.artifacts.planReview ?? 'not created yet'}
implementationReview: ${input.artifacts.implementationReview ?? 'not created yet'}

## Body
${input.issueBody}`.trim();
}

export function buildWorkflowKernel(input: WorkflowKernelInput): string {
  return `Continue the issueflow workflow for issue #${input.issueNumber}.

Required stage order:
1. Issue Intake
2. Brainstorming with superpowers:brainstorming
3. Spec
4. User Review Gate
5. Plan with superpowers:writing-plans
6. Review Gate 1 in a separate review agent
7. Implementation with superpowers:test-driven-development
8. Review Gate 2 in a separate review agent
9. Verification with superpowers:verification-before-completion

Use \`git rev-parse --git-path issueflow/current-issue.md\` as the issue packet path and \`git rev-parse --git-path issueflow/session.json\` as the persisted state path.
Never skip the two review gates.`.trim();
}
