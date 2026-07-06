import fs from 'node:fs/promises';

import { Command, InvalidArgumentError } from 'commander';

import { findIssueArtifacts } from '../core/artifacts.js';
import { resolveRepoRoot } from '../core/git.js';
import { IssueIdError, resolveIssueNumber } from '../core/issue-id.js';
import { defaultSetExitCode, defaultWrite, type WriteChannel } from './shared.js';

export interface ReportSummary {
  path: string;
  frontmatter: Record<string, string | number>;
}

export interface ReportsShowResult {
  issueNumber: number;
  testReport: ReportSummary | null;
  reviewReport: ReportSummary | null;
}

export interface ReportsCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveIssueNumber: (repoRoot: string, override: number | undefined) => Promise<number>;
  findIssueArtifacts: typeof findIssueArtifacts;
  readFile: (path: string) => Promise<string>;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: ReportsCommandDeps = {
  resolveRepoRoot,
  resolveIssueNumber: (repoRoot, override) => resolveIssueNumber(repoRoot, override),
  findIssueArtifacts,
  readFile: (filePath) => fs.readFile(filePath, 'utf8'),
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

function parseFrontmatter(markdown: string): Record<string, string | number> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    return {};
  }

  const frontmatter: Record<string, string | number> = {};
  for (const line of match[1]?.split('\n') ?? []) {
    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    const numeric = Number(rawValue);
    frontmatter[key] = Number.isFinite(numeric) && rawValue !== '' ? numeric : rawValue;
  }

  return frontmatter;
}

async function loadReportSummary(
  deps: ReportsCommandDeps,
  path: string | null
): Promise<ReportSummary | null> {
  if (!path) {
    return null;
  }

  const markdown = await deps.readFile(path);
  return {
    path,
    frontmatter: parseFrontmatter(markdown)
  };
}

function formatTestSummary(report: ReportSummary | null): string {
  if (!report) {
    return 'testReport: not generated yet';
  }

  const status = report.frontmatter.status ?? 'unknown';
  const passed = report.frontmatter.passedCount ?? '?';
  const total = report.frontmatter.checkCount ?? '?';
  return `test: ${status}, ${passed}/${total} checks (${report.path})`;
}

function formatReviewSummary(report: ReportSummary | null): string {
  if (!report) {
    return 'reviewReport: not generated yet';
  }

  const planGate = report.frontmatter.planGate ?? 'unknown';
  const implementationGate = report.frontmatter.implementationGate ?? 'unknown';
  return `review: plan ${planGate}, implementation ${implementationGate} (${report.path})`;
}

export async function showReports(
  input: { cwd: string; issue?: number; json?: boolean },
  deps: ReportsCommandDeps = defaultDeps
): Promise<ReportsShowResult> {
  const repoRoot = await deps.resolveRepoRoot(input.cwd);
  const issueNumber = await deps.resolveIssueNumber(repoRoot, input.issue);
  const artifacts = await deps.findIssueArtifacts(repoRoot, issueNumber);
  const testReport = await loadReportSummary(deps, artifacts.testReport);
  const reviewReport = await loadReportSummary(deps, artifacts.reviewReport);
  const result = { issueNumber, testReport, reviewReport };

  if (input.json) {
    deps.write('stdout', `${JSON.stringify(result, null, 2)}\n`);
  } else {
    deps.write('stdout', `Issue #${issueNumber}\n`);
    deps.write('stdout', `${formatTestSummary(testReport)}\n`);
    deps.write('stdout', `${formatReviewSummary(reviewReport)}\n`);
  }

  return result;
}

export async function showAction(options: { issue?: number; json?: boolean }): Promise<void> {
  try {
    await showReports({ cwd: process.cwd(), issue: options.issue, json: options.json });
  } catch (error) {
    if (error instanceof IssueIdError) {
      defaultDeps.write('stderr', `${error.message}\n`);
      defaultDeps.setExitCode(2);
      return;
    }

    throw error;
  }
}

export function registerReportsCommands(program: Command): void {
  const reports = program.command('reports').description('Inspect workflow report artifacts');

  reports
    .command('show')
    .description('Show TEST_REPORT.md and REVIEW_REPORT.md for an issue')
    .option('--issue <number>', 'Issue id', (value) => {
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`--issue must be a positive integer (got "${value}").`);
      }
      return Number.parseInt(value, 10);
    })
    .option('--json', 'Print structured JSON')
    .action(showAction);
}
