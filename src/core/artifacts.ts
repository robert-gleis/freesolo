import fs from 'node:fs/promises';
import path from 'node:path';

import type { IssueArtifactPaths } from './types.js';

type ReviewArtifactKind = 'plan' | 'implementation';

async function readDirectoryEntries(absoluteDir: string): Promise<string[] | null> {
  try {
    return await fs.readdir(absoluteDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

async function findLatestArtifact(repoRoot: string, relativeDir: string[], issueNumber: number, suffix: string): Promise<string | null> {
  const absoluteDir = path.join(repoRoot, ...relativeDir);
  const entries = await readDirectoryEntries(absoluteDir);

  if (!entries) {
    return null;
  }

  const issueMarker = `issue-${issueNumber}-`;
  const match = entries
    .filter((entry) => entry.includes(issueMarker) && entry.endsWith(suffix))
    .sort()
    .at(-1);

  return match ? path.join(absoluteDir, match) : null;
}

async function findLatestReviewArtifact(repoRoot: string, issueNumber: number, kind: ReviewArtifactKind): Promise<string | null> {
  const absoluteDir = path.join(repoRoot, 'docs', 'issueflow', 'reviews');
  const entries = await readDirectoryEntries(absoluteDir);

  if (!entries) {
    return null;
  }

  const issueMarker = `issue-${issueNumber}-`;
  const numberedReview = entries
    .filter((entry) => entry.includes(issueMarker))
    .filter((entry) => entry.includes(`-${kind}-review-round-`))
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .at(-1);

  if (numberedReview) {
    return path.join(absoluteDir, numberedReview);
  }

  const legacyReview = entries
    .filter((entry) => entry.includes(issueMarker) && entry.endsWith(`-${kind}-review.md`))
    .sort()
    .at(-1);

  return legacyReview ? path.join(absoluteDir, legacyReview) : null;
}

export async function findIssueArtifacts(repoRoot: string, issueNumber: number): Promise<IssueArtifactPaths> {
  const [spec, plan, planReview, implementationReview] = await Promise.all([
    findLatestArtifact(repoRoot, ['docs', 'issueflow', 'specs'], issueNumber, '-design.md'),
    findLatestArtifact(repoRoot, ['docs', 'issueflow', 'plans'], issueNumber, '-plan.md'),
    findLatestReviewArtifact(repoRoot, issueNumber, 'plan'),
    findLatestReviewArtifact(repoRoot, issueNumber, 'implementation')
  ]);

  return {
    spec,
    plan,
    planReview,
    implementationReview
  };
}
