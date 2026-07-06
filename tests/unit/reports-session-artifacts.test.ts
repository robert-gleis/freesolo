import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { updateSessionReportArtifact } from '../../src/reports/session-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('updateSessionReportArtifact', () => {
  it('updates testReport on the session', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-session-artifacts-'));
    tempDirs.push(worktreePath);
    await execa('git', ['init'], { cwd: worktreePath });

    const sessionPath = path.join(worktreePath, '.git', 'freesolo', 'session.json');
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(
      sessionPath,
      JSON.stringify(
        {
          issueNumber: 30,
          issueSlug: 'reviewer-artifact-generation',
          repoRoot: worktreePath,
          branchName: 'issue/30-reviewer-artifact-generation',
          worktreePath,
          chosenHost: 'cursor',
          currentStage: 'implementation',
          reviewGates: { plan: 'pass', implementation: 'pending' },
          reviewLoops: {
            plan: { currentRound: 1, maxRounds: 5 },
            implementation: { currentRound: 1, maxRounds: 5 }
          },
          createdAt: '2026-06-08T10:00:00.000Z',
          updatedAt: '2026-06-08T10:00:00.000Z',
          artifacts: {
            spec: null,
            plan: null,
            planReview: null,
            implementationReview: null
          }
        },
        null,
        2
      )
    );

    const reportPath = path.join(worktreePath, '.git', 'freesolo', 'reports', 'issue-30', 'TEST_REPORT.md');
    await updateSessionReportArtifact(worktreePath, 'testReport', reportPath);

    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    expect(session.artifacts.testReport).toBe(reportPath);
  });

  it('returns without throwing when session.json is missing', async () => {
    const worktreePath = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-session-artifacts-'));
    tempDirs.push(worktreePath);
    await execa('git', ['init'], { cwd: worktreePath });

    await expect(
      updateSessionReportArtifact(worktreePath, 'testReport', '/tmp/TEST_REPORT.md')
    ).resolves.toBeUndefined();
  });
});
