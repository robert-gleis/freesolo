import fs from 'node:fs/promises';
import path from 'node:path';

import type { IssueArtifactPaths } from './types.js';

async function findLatestArtifact(repoRoot: string, relativeDir: string[], issueNumber: number, suffix: string): Promise<string | null> {
  const absoluteDir = path.join(repoRoot, ...relativeDir);

  let entries: string[];
  try {
    entries = await fs.readdir(absoluteDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }

  const issueMarker = `issue-${issueNumber}-`;
  const match = entries
    .filter((entry) => entry.includes(issueMarker) && entry.endsWith(suffix))
    .sort()
    .at(-1);

  return match ? path.join(absoluteDir, match) : null;
}

export async function findIssueArtifacts(repoRoot: string, issueNumber: number): Promise<IssueArtifactPaths> {
  const [spec, plan, planReview, implementationReview] = await Promise.all([
    findLatestArtifact(repoRoot, ['docs', 'issueflow', 'specs'], issueNumber, '-design.md'),
    findLatestArtifact(repoRoot, ['docs', 'issueflow', 'plans'], issueNumber, '-plan.md'),
    findLatestArtifact(repoRoot, ['docs', 'issueflow', 'reviews'], issueNumber, '-plan-review.md'),
    findLatestArtifact(repoRoot, ['docs', 'issueflow', 'reviews'], issueNumber, '-implementation-review.md')
  ]);

  return {
    spec,
    plan,
    planReview,
    implementationReview
  };
}
