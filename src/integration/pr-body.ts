import type { VerificationRun } from '../verification/types.js';

export function buildPullRequestTitle(issueNumber: number, issueSlug: string): string {
  const titleWords = issueSlug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return `Issue #${issueNumber}: ${titleWords}`;
}

export interface ExtractSummaryInput {
  specMarkdown?: string;
  planMarkdown?: string;
  issueNumber?: number;
  issueSlug?: string;
}

export function extractSummary(input: ExtractSummaryInput): string {
  if (input.specMarkdown) {
    const match = input.specMarkdown.match(/## Summary\s*\n+([\s\S]*?)(?=\n## |\n*$)/);
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }

  if (input.planMarkdown) {
    const goalMatch = input.planMarkdown.match(/\*\*Goal:\*\*\s*(.+)/);
    if (goalMatch?.[1]?.trim()) {
      return goalMatch[1].trim();
    }

    const summaryMatch = input.planMarkdown.match(/## Summary\s*\n+([\s\S]*?)(?=\n## |\n*$)/);
    if (summaryMatch?.[1]?.trim()) {
      return summaryMatch[1].trim();
    }
  }

  if (input.issueNumber !== undefined && input.issueSlug) {
    return `Automated changes for issue #${input.issueNumber} (${input.issueSlug}).`;
  }

  throw new Error('summary-unavailable');
}

export function formatTestResultsSection(run: VerificationRun): string {
  const lines = [
    `Verification run \`${run.runId}\` finished at \`${run.finishedAt}\` with status **${run.status}**.`,
    '',
    '| Check | Status | Duration |',
    '| --- | --- | --- |'
  ];

  for (const check of run.checks) {
    const durationSeconds = (check.durationMs / 1000).toFixed(1);
    lines.push(`| ${check.name} | ${check.status} | ${durationSeconds}s |`);
  }

  return lines.join('\n');
}

export interface BuildPullRequestBodyInput {
  issueNumber: number;
  summary: string;
  verificationRun: VerificationRun;
  reviewMarkdown: string;
}

export function buildPullRequestBody(input: BuildPullRequestBodyInput): string {
  const sections = [
    '## Summary',
    '',
    input.summary,
    '',
    '## Test Results',
    '',
    formatTestResultsSection(input.verificationRun),
    '',
    '## Review Results',
    '',
    input.reviewMarkdown.trim(),
    '',
    '---',
    '',
    `Closes #${input.issueNumber}`
  ];

  return sections.join('\n');
}
