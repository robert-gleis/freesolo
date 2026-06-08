import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { findIssueArtifacts } from '../../src/core/artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('findIssueArtifacts', () => {
  it('discovers existing spec, plan, and review artifacts for the selected issue', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/specs'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/plans'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/reviews'), { recursive: true });

    const specPath = path.join(repoRoot, 'docs/issueflow/specs/2026-04-20-issue-12-design.md');
    const planPath = path.join(repoRoot, 'docs/issueflow/plans/2026-04-21-issue-12-plan.md');
    const implementationReviewPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-22-issue-12-implementation-review.md');

    await fs.writeFile(specPath, '# spec');
    await fs.writeFile(planPath, '# plan');
    await fs.writeFile(implementationReviewPath, '# review');
    await fs.writeFile(path.join(repoRoot, 'docs/issueflow/specs/2026-04-20-issue-99-design.md'), '# other');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts).toEqual({
      spec: specPath,
      plan: planPath,
      planReview: null,
      implementationReview: implementationReviewPath,
      testReport: null,
      reviewReport: null
    });
  });

  it('discovers report artifacts from the issueflow reports directory', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-artifacts-'));
    tempDirs.push(repoRoot);

    await execa('git', ['init'], { cwd: repoRoot });

    const reportsDir = path.join(repoRoot, '.git', 'issueflow', 'reports', 'issue-12');
    await fs.mkdir(reportsDir, { recursive: true });

    const testReportPath = path.join(reportsDir, 'TEST_REPORT.md');
    const reviewReportPath = path.join(reportsDir, 'REVIEW_REPORT.md');
    await fs.writeFile(testReportPath, '# test report');
    await fs.writeFile(reviewReportPath, '# review report');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.testReport).toBe(testReportPath);
    expect(artifacts.reviewReport).toBe(reviewReportPath);
  });

  it('prefers the latest numbered plan review artifact', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/reviews'), { recursive: true });

    const oldPlanReviewPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-21-issue-12-plan-review.md');
    const roundOnePath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-22-issue-12-plan-review-round-1.md');
    const roundTwoPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-22-issue-12-plan-review-round-2.md');

    await fs.writeFile(oldPlanReviewPath, '# old review');
    await fs.writeFile(roundOnePath, '# round 1');
    await fs.writeFile(roundTwoPath, '# round 2');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.planReview).toBe(roundTwoPath);
  });

  it('prefers the latest numbered implementation review artifact', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/reviews'), { recursive: true });

    const roundThreePath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-23-issue-12-implementation-review-round-3.md');
    const roundFourPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-23-issue-12-implementation-review-round-4.md');

    await fs.writeFile(roundThreePath, '# round 3');
    await fs.writeFile(roundFourPath, '# round 4');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.implementationReview).toBe(roundFourPath);
  });

  it('keeps reading old unnumbered review artifact names', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/reviews'), { recursive: true });

    const planReviewPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-21-issue-12-plan-review.md');
    const implementationReviewPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-22-issue-12-implementation-review.md');

    await fs.writeFile(planReviewPath, '# plan review');
    await fs.writeFile(implementationReviewPath, '# implementation review');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts.planReview).toBe(planReviewPath);
    expect(artifacts.implementationReview).toBe(implementationReviewPath);
  });
});
