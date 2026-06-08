import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
const scriptPath = path.resolve('integrations/skills/issueflow-workflow/scripts/review-loop.mjs');
const scriptEnv = { ISSUEFLOW_REVIEW_DATE: '2026-04-24' };

beforeAll(async () => {
  await execa('npm', ['run', 'build'], { cwd: process.cwd() });
}, 120_000);

async function createRepo(): Promise<string> {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-review-loop-'));
  tempDirs.push(repoRoot);

  await execa('git', ['init'], { cwd: repoRoot });
  const gitDir = path.join(repoRoot, '.git');
  await fs.mkdir(path.join(gitDir, 'issueflow'), { recursive: true });
  await fs.writeFile(
    path.join(gitDir, 'issueflow/session.json'),
    JSON.stringify(
      {
        issueNumber: 12,
        issueSlug: 'ship-issueflow-start',
        repoRoot,
        branchName: 'issue/12-ship-issueflow-start',
        worktreePath: repoRoot,
        chosenHost: 'codex',
        currentStage: 'plan-review',
        reviewGates: {
          plan: 'pending',
          implementation: 'pending'
        },
        reviewLoops: {
          plan: {
            currentRound: 1,
            maxRounds: 5
          },
          implementation: {
            currentRound: 1,
            maxRounds: 5
          }
        },
        createdAt: '2026-04-24T10:00:00.000Z',
        updatedAt: '2026-04-24T10:00:00.000Z',
        artifacts: {
          spec: `${repoRoot}/docs/issueflow/specs/2026-04-20-issue-12-design.md`,
          plan: `${repoRoot}/docs/issueflow/plans/2026-04-21-issue-12-plan.md`,
          planReview: null,
          implementationReview: null
        }
      },
      null,
      2
    )
  );

  return repoRoot;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('review-loop skill script', () => {
  it('prints reviewer handoff details for the current round', async () => {
    const repoRoot = await createRepo();

    const { stdout } = await execa('node', [scriptPath, 'next-review', '--gate', 'plan'], { cwd: repoRoot, env: scriptEnv });

    expect(stdout).toContain('Gate: plan');
    expect(stdout).toContain('Round: 1/5');
    expect(stdout).toContain('fresh reviewer agent');
    expect(stdout).toContain('docs/issueflow/reviews/2026-04-24-issue-12-plan-review-round-1.md');
  });

  it('records findings and advances to the next round with fixer handoff details', async () => {
    const repoRoot = await createRepo();

    const { stdout } = await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'plan', '--status', 'pass_with_findings', '--artifact', 'docs/issueflow/reviews/2026-04-24-issue-12-plan-review-round-1.md'],
      { cwd: repoRoot, env: scriptEnv }
    );

    const session = JSON.parse(await fs.readFile(path.join(repoRoot, '.git/issueflow/session.json'), 'utf8'));
    const reviewReportPath = path.join(repoRoot, '.git', 'issueflow', 'reports', 'issue-12', 'REVIEW_REPORT.md');

    expect(stdout).toContain('spawn a separate fixer agent');
    expect(stdout).toContain('Next review round: 2/5');
    expect(session.reviewGates.plan).toBe('pass_with_findings');
    expect(session.reviewLoops.plan.currentRound).toBe(2);
    expect(session.artifacts.planReview).toBe(`${repoRoot}/docs/issueflow/reviews/2026-04-24-issue-12-plan-review-round-1.md`);
    await expect(fs.access(reviewReportPath)).rejects.toThrow();
    expect(session.artifacts.reviewReport ?? null).toBeNull();
  });

  it('blocks the gate when findings remain at round 5', async () => {
    const repoRoot = await createRepo();
    const sessionPath = path.join(repoRoot, '.git/issueflow/session.json');
    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    session.reviewLoops.plan.currentRound = 5;
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));

    const { stdout } = await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'plan', '--status', 'pass_with_findings', '--artifact', 'docs/issueflow/reviews/2026-04-24-issue-12-plan-review-round-5.md'],
      { cwd: repoRoot, env: scriptEnv }
    );
    const updatedSession = JSON.parse(await fs.readFile(sessionPath, 'utf8'));

    expect(stdout).toContain('Do not proceed after round 5');
    expect(updatedSession.reviewGates.plan).toBe('block');
    expect(updatedSession.reviewLoops.plan.currentRound).toBe(5);
  });

  it('writes a review report when the plan gate passes', async () => {
    const repoRoot = await createRepo();
    const reviewsDir = path.join(repoRoot, 'docs/issueflow/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(path.join(reviewsDir, '2026-04-24-issue-12-plan-review-round-1.md'), '# Round 1\n\n## Verdict\npass');

    await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'plan', '--status', 'pass', '--artifact', 'docs/issueflow/reviews/2026-04-24-issue-12-plan-review-round-1.md'],
      { cwd: repoRoot, env: scriptEnv }
    );

    const session = JSON.parse(await fs.readFile(path.join(repoRoot, '.git/issueflow/session.json'), 'utf8'));
    const reviewReportPath = path.join(repoRoot, '.git', 'issueflow', 'reports', 'issue-12', 'REVIEW_REPORT.md');

    await fs.access(reviewReportPath);
    expect(session.artifacts.reviewReport).toBe(reviewReportPath);
  });

  it('passes the gate when review status is pass', async () => {
    const repoRoot = await createRepo();
    const reviewsDir = path.join(repoRoot, 'docs/issueflow/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    const artifactPath = path.join(reviewsDir, '2026-04-24-issue-12-implementation-review-round-1.md');
    await fs.writeFile(artifactPath, '# Round 1\n\n## Verdict\npass');

    const { stdout } = await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'implementation', '--status', 'pass', '--artifact', 'docs/issueflow/reviews/2026-04-24-issue-12-implementation-review-round-1.md'],
      { cwd: repoRoot, env: scriptEnv }
    );
    const session = JSON.parse(await fs.readFile(path.join(repoRoot, '.git/issueflow/session.json'), 'utf8'));
    const reviewReportPath = path.join(repoRoot, '.git', 'issueflow', 'reports', 'issue-12', 'REVIEW_REPORT.md');

    expect(stdout).toContain('Gate passed with no findings');
    expect(session.reviewGates.implementation).toBe('pass');
    expect(session.artifacts.implementationReview).toBe(`${repoRoot}/docs/issueflow/reviews/2026-04-24-issue-12-implementation-review-round-1.md`);
    await fs.access(reviewReportPath);
    expect(session.artifacts.reviewReport).toBe(reviewReportPath);
  });

  it('does not write a review report when the gate is blocked', async () => {
    const repoRoot = await createRepo();
    const sessionPath = path.join(repoRoot, '.git/issueflow/session.json');
    const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    session.reviewLoops.plan.currentRound = 5;
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));

    await execa(
      'node',
      [scriptPath, 'record-review', '--gate', 'plan', '--status', 'block', '--artifact', 'docs/issueflow/reviews/2026-04-24-issue-12-plan-review-round-5.md'],
      { cwd: repoRoot, env: scriptEnv }
    );

    const updatedSession = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
    const reviewReportPath = path.join(repoRoot, '.git', 'issueflow', 'reports', 'issue-12', 'REVIEW_REPORT.md');

    await expect(fs.access(reviewReportPath)).rejects.toThrow();
    expect(updatedSession.artifacts.reviewReport ?? null).toBeNull();
  });
});
