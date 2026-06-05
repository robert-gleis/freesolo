import type { IssueArtifactPaths } from '../core/types.js';
import type { AdrRecord } from '../memory/adrs.js';

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
  adrs?: AdrRecord[];
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none';
}

export function buildReviewLoopInstructions(): string {
  return `Review/fix loop rules for both review gates:
- Run each review gate for up to 5 rounds.
- For each round, spawn a fresh reviewer agent.
- The reviewer writes a round-specific artifact under docs/issueflow/reviews using -round-<round>.md in the filename.
- If the reviewer passes with no findings, mark the gate as pass and continue.
- If the reviewer reports findings, mark the gate as pass_with_findings, spawn a separate fixer agent with the review artifact as input, apply the fixes, then start the next round with a fresh reviewer agent.
- Do not proceed after round 5 if findings remain; mark the gate as block and ask the user how to proceed.`.trim();
}

function formatAdrSection(adrs: AdrRecord[]): string {
  if (adrs.length === 0) {
    return '## Architecture Decision Records\n\nNo numbered ADRs found under docs/adr/.';
  }

  const blocks = adrs.map((adr) => {
    const padded = String(adr.number).padStart(4, '0');
    return `### ADR-${padded}: ${adr.slug}\nPath: ${adr.relativePath}\n\n${adr.content.trim()}`;
  });

  return `## Architecture Decision Records\n\n${blocks.join('\n\n')}`;
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
${input.issueBody}

${formatAdrSection(input.adrs ?? [])}`.trim();
}

export function buildWorkflowKernel(input: WorkflowKernelInput): string {
  return `Continue the issueflow workflow for issue #${input.issueNumber}.

Required stage order:
1. Issue Intake
2. Brainstorming with superpowers:brainstorming
3. Spec
4. User Review Gate
5. Plan with superpowers:writing-plans
6. Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
7. Implementation with superpowers:test-driven-development
8. Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
9. Verification with superpowers:verification-before-completion

${buildReviewLoopInstructions()}

Use \`git rev-parse --git-path issueflow/current-issue.md\` as the issue packet path and \`git rev-parse --git-path issueflow/session.json\` as the persisted state path.
Never skip the two review/fix loops.`.trim();
}
