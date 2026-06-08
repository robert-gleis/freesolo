import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('reports command integration', () => {
  it('shows report paths as JSON for an issue', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-reports-integration-'));
    tempDirs.push(repoRoot);
    await execa('git', ['init'], { cwd: repoRoot });

    const reportsDir = path.join(repoRoot, '.git', 'issueflow', 'reports', 'issue-99');
    await fs.mkdir(reportsDir, { recursive: true });

    const testReportPath = path.join(reportsDir, 'TEST_REPORT.md');
    const reviewReportPath = path.join(reportsDir, 'REVIEW_REPORT.md');
    await fs.writeFile(
      testReportPath,
      '---\nkind: test-report\nstatus: pass\ncheckCount: 1\npassedCount: 1\n---\n'
    );
    await fs.writeFile(
      reviewReportPath,
      '---\nkind: review-report\nplanGate: pass\nimplementationGate: pending\n---\n'
    );

    const binPath = path.resolve('dist/src/bin.js');
    const { stdout } = await execa('node', [binPath, 'reports', 'show', '--issue', '99', '--json'], {
      cwd: repoRoot
    });

    const parsed = JSON.parse(stdout) as {
      issueNumber: number;
      testReport: { path: string } | null;
      reviewReport: { path: string } | null;
    };

    expect(parsed.issueNumber).toBe(99);
    expect(parsed.testReport?.path).toMatch(/issue-99\/TEST_REPORT\.md$/);
    expect(parsed.reviewReport?.path).toMatch(/issue-99\/REVIEW_REPORT\.md$/);
  });
});
