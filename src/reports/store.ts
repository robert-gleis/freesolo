import fs from 'node:fs/promises';
import path from 'node:path';

import { buildReviewReportMarkdown, type BuildReviewReportInput } from './review-report.js';
import { buildTestReportMarkdown } from './test-report.js';
import { gitIssueflowPath } from '../core/session-state.js';
import type { VerificationRun } from '../verification/types.js';

export async function getIssueReportsDir(repoRoot: string, issueNumber: number): Promise<string> {
  return gitIssueflowPath(repoRoot, 'reports', `issue-${issueNumber}`);
}

export async function writeTestReportToDisk(
  run: VerificationRun,
  deps: { now?: () => Date } = {}
): Promise<string> {
  const reportsDir = await getIssueReportsDir(run.repoRoot, run.issueNumber);
  await fs.mkdir(reportsDir, { recursive: true });

  const generatedAt = (deps.now ?? (() => new Date()))().toISOString();
  const markdown = buildTestReportMarkdown(run, generatedAt);
  const reportPath = path.join(reportsDir, 'TEST_REPORT.md');
  await fs.writeFile(reportPath, markdown);

  return reportPath;
}

export async function writeReviewReportToDisk(input: BuildReviewReportInput): Promise<string> {
  const reportsDir = await getIssueReportsDir(input.repoRoot, input.issueNumber);
  await fs.mkdir(reportsDir, { recursive: true });

  const markdown = await buildReviewReportMarkdown(input);
  const reportPath = path.join(reportsDir, 'REVIEW_REPORT.md');
  await fs.writeFile(reportPath, markdown);

  return reportPath;
}
