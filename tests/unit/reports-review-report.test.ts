import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildReviewReportMarkdown,
  listReviewRoundArtifacts,
  parseReviewArtifactSummary
} from '../../src/reports/review-report.js';
import type { SessionState } from '../../src/core/session-state.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    issueNumber: 12,
    issueSlug: 'ship-issueflow-start',
    repoRoot: '/repo',
    branchName: 'issue/12-ship-issueflow-start',
    worktreePath: '/repo',
    chosenHost: 'codex',
    currentStage: 'plan-review',
    reviewGates: {
      plan: 'pass',
      implementation: 'pending'
    },
    reviewLoops: {
      plan: { currentRound: 2, maxRounds: 5 },
      implementation: { currentRound: 1, maxRounds: 5 }
    },
    createdAt: '2026-06-08T10:00:00.000Z',
    updatedAt: '2026-06-08T14:00:00.000Z',
    artifacts: {
      spec: null,
      plan: null,
      planReview: null,
      implementationReview: null,
      testReport: null,
      reviewReport: null
    },
    ...overrides
  };
}

describe('parseReviewArtifactSummary', () => {
  it('extracts verdict and findings count', () => {
    const summary = parseReviewArtifactSummary(`# Review\n\n## Verdict\npass_with_findings\n\n## Findings\n\n### Finding 1\n\n### Finding 2`);

    expect(summary).toEqual({ verdict: 'pass_with_findings', findingsCount: 2 });
  });

  it('returns unknown findings count when verdict is missing', () => {
    const summary = parseReviewArtifactSummary('# Review\n\nNo structured sections here.');

    expect(summary).toEqual({ verdict: null, findingsCount: 'unknown' });
  });
});

describe('listReviewRoundArtifacts', () => {
  it('discovers dated review round files', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-review-report-'));
    tempDirs.push(repoRoot);

    const reviewsDir = path.join(repoRoot, 'docs/issueflow/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-1.md'), '# round 1');
    await fs.writeFile(path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-2.md'), '# round 2');

    const artifacts = await listReviewRoundArtifacts(repoRoot, 12, 'plan');

    expect(artifacts).toHaveLength(2);
    expect(artifacts[0]?.round).toBe(1);
    expect(artifacts[1]?.round).toBe(2);
  });
});

describe('buildReviewReportMarkdown', () => {
  it('builds a plan-only report with gate status and verdict excerpts', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-review-report-'));
    tempDirs.push(repoRoot);

    const reviewsDir = path.join(repoRoot, 'docs/issueflow/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(
      path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-1.md'),
      '# Round 1\n\n## Verdict\npass_with_findings\n\n## Findings\n\n### Finding 1'
    );
    await fs.writeFile(path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-2.md'), '# Round 2\n\n## Verdict\npass');

    const markdown = await buildReviewReportMarkdown({
      repoRoot,
      issueNumber: 12,
      session: makeSession(),
      generatedAt: '2026-06-08T14:00:00.000Z'
    });

    expect(markdown).toContain('planRoundsCompleted: 2');
    expect(markdown).toContain('implementationRoundsCompleted: 0');
    expect(markdown).toContain('| 1 |');
    expect(markdown).toContain('pass_with_findings');
    expect(markdown).toContain('### Round 1 — pass_with_findings');
    expect(markdown).toContain('_Not started._');
  });

  it('builds both plan and implementation sections when both gates pass', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-review-report-'));
    tempDirs.push(repoRoot);

    const reviewsDir = path.join(repoRoot, 'docs/issueflow/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-1.md'), '# Round 1\n\n## Verdict\npass');
    await fs.writeFile(
      path.join(reviewsDir, '2026-06-08-issue-12-implementation-review-round-1.md'),
      '# Round 1\n\n## Verdict\npass'
    );

    const markdown = await buildReviewReportMarkdown({
      repoRoot,
      issueNumber: 12,
      session: makeSession({
        reviewGates: { plan: 'pass', implementation: 'pass' },
        reviewLoops: {
          plan: { currentRound: 1, maxRounds: 5 },
          implementation: { currentRound: 1, maxRounds: 5 }
        }
      }),
      generatedAt: '2026-06-08T14:00:00.000Z'
    });

    expect(markdown).toContain('## Plan review');
    expect(markdown).toContain('## Implementation review');
    expect(markdown).not.toContain('_Not started._');
    expect(markdown).toContain('Implementation review **pass** after 1 round(s).');
  });

  it('notes missing artifacts and unknown findings', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-review-report-'));
    tempDirs.push(repoRoot);

    const reviewsDir = path.join(repoRoot, 'docs/issueflow/reviews');
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(
      path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-1.md'),
      '# Round 1\n\nNo structured sections here.'
    );

    const missingImplementationPath = path.join(
      reviewsDir,
      '2026-06-08-issue-12-implementation-review-round-1.md'
    );

    const markdown = await buildReviewReportMarkdown({
      repoRoot,
      issueNumber: 12,
      session: makeSession({
        reviewGates: { plan: 'pass', implementation: 'pass' },
        reviewLoops: {
          plan: { currentRound: 1, maxRounds: 5 },
          implementation: { currentRound: 1, maxRounds: 5 }
        },
        artifacts: {
          spec: null,
          plan: null,
          planReview: path.join(reviewsDir, '2026-06-08-issue-12-plan-review-round-1.md'),
          implementationReview: missingImplementationPath,
          testReport: null,
          reviewReport: null
        }
      }),
      generatedAt: '2026-06-08T14:00:00.000Z'
    });

    expect(markdown).toContain('| unknown |');
    expect(markdown).toContain('artifact missing');
  });
});
