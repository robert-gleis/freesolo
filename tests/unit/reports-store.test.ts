import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { getIssueReportsDir, writeTestReportToDisk } from '../../src/reports/store.js';
import type { VerificationRun } from '../../src/verification/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeRun(repoRoot: string): VerificationRun {
  const runDirectory = path.join(repoRoot, '.git', 'issueflow', 'verifications', 'issue-99', 'run-1');

  return {
    schemaVersion: 1,
    runId: 'run-1',
    issueNumber: 99,
    repoRoot,
    configPath: path.join(repoRoot, 'issueflow.config.json'),
    startedAt: '2026-06-08T10:00:00.000Z',
    finishedAt: '2026-06-08T10:01:00.000Z',
    status: 'pass',
    bail: false,
    checks: [
      {
        name: 'lint',
        command: 'npm',
        args: ['run', 'lint'],
        cwd: repoRoot,
        status: 'pass',
        exitCode: 0,
        signal: null,
        startedAt: '2026-06-08T10:00:00.000Z',
        finishedAt: '2026-06-08T10:01:00.000Z',
        durationMs: 1000,
        logPath: path.join(runDirectory, 'lint.log')
      }
    ]
  };
}

describe('reports store', () => {
  it('writes TEST_REPORT.md under the issue reports directory', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-reports-store-'));
    tempDirs.push(repoRoot);
    await execa('git', ['init'], { cwd: repoRoot });

    const reportPath = await writeTestReportToDisk(makeRun(repoRoot), {
      now: () => new Date('2026-06-08T10:02:00.000Z')
    });
    const reportsDir = await getIssueReportsDir(repoRoot, 99);
    const markdown = await fs.readFile(reportPath, 'utf8');

    expect(reportPath).toBe(path.join(reportsDir, 'TEST_REPORT.md'));
    expect(markdown).toContain('kind: test-report');
    expect(markdown).toContain('issueNumber: 99');
  });
});
