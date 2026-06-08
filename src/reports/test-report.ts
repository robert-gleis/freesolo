import path from 'node:path';

import type { TestReportFrontmatter } from './types.js';
import { REPORT_SCHEMA_VERSION } from './types.js';
import type { VerificationRun } from '../verification/types.js';

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  const seconds = durationMs / 1000;
  return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
}

function formatSignal(signal: string | null): string {
  return signal ?? '—';
}

function formatExitCode(exitCode: number | null): string {
  return exitCode === null ? '—' : String(exitCode);
}

function formatLogCell(logPath: string, runDirectory: string): string {
  const basename = path.basename(logPath);
  const relative = path.relative(runDirectory, logPath);

  if (relative && relative !== basename && !relative.startsWith('..')) {
    return `\`${basename}\` (${relative})`;
  }

  return `\`${basename}\``;
}

function serializeFrontmatter(frontmatter: TestReportFrontmatter): string {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (typeof value === 'string') {
      return `${key}: ${value}`;
    }

    return `${key}: ${value}`;
  });

  return `---\n${lines.join('\n')}\n---`;
}

export function buildTestReportMarkdown(run: VerificationRun, generatedAt: string): string {
  const runDirectory = path.dirname(run.checks[0]?.logPath ?? path.join(run.repoRoot, run.runId));
  const passedCount = run.checks.filter((check) => check.status === 'pass').length;
  const failedCount = run.checks.filter((check) => check.status === 'fail').length;
  const skippedCount = run.checks.filter((check) => check.status === 'skipped').length;

  const frontmatter: TestReportFrontmatter = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: 'test-report',
    issueNumber: run.issueNumber,
    runId: run.runId,
    status: run.status,
    generatedAt,
    repoRoot: run.repoRoot,
    configPath: run.configPath,
    bail: run.bail,
    checkCount: run.checks.length,
    passedCount,
    failedCount,
    skippedCount,
    runDirectory
  };

  const summary = `Verification run **${run.status}** (\`${run.runId}\`). ${passedCount}/${run.checks.length} checks passed.`;
  const tableHeader = '| Name | Status | Duration | Exit | Signal | Log |';
  const tableDivider = '|------|--------|----------|------|--------|-----|';
  const tableRows = run.checks.map((check) => {
    return `| ${check.name} | ${check.status} | ${formatDurationMs(check.durationMs)} | ${formatExitCode(check.exitCode)} | ${formatSignal(check.signal)} | ${formatLogCell(check.logPath, runDirectory)} |`;
  });

  return [
    serializeFrontmatter(frontmatter),
    `# Test Report — Issue #${run.issueNumber}`,
    '',
    '## Summary',
    '',
    summary,
    '',
    '## Checks',
    '',
    tableHeader,
    tableDivider,
    ...tableRows,
    '',
    '## Run metadata',
    '',
    `- **Started:** ${run.startedAt}`,
    `- **Finished:** ${run.finishedAt}`,
    ''
  ].join('\n');
}
