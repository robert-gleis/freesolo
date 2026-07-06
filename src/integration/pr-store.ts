import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { getFreesoloPath } from '../core/session-state.js';
import { PullRequestError, type PullRequestRecord } from './pr-types.js';

export const pullRequestRecordSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueSlug: z.string().min(1),
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  title: z.string().min(1),
  headBranch: z.string().min(1),
  baseBranch: z.string().min(1),
  verificationRunId: z.string().min(1),
  implementationReviewPath: z.string().min(1),
  specPath: z.string().nullable(),
  createdAt: z.string().min(1)
});

export async function getPullRequestPath(worktreePath: string): Promise<string> {
  const rawPath = await getFreesoloPath(worktreePath, 'pull-request.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

function parseRecord(contents: string): PullRequestRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new PullRequestError('invalid-record', 'pull request record is not valid JSON');
  }

  const result = pullRequestRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new PullRequestError('invalid-record', result.error.message);
  }

  return result.data;
}

export async function readPullRequestRecord(worktreePath: string): Promise<PullRequestRecord | null> {
  const recordPath = await getPullRequestPath(worktreePath);

  try {
    const contents = await fs.readFile(recordPath, 'utf8');
    return parseRecord(contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function writePullRequestRecord(
  worktreePath: string,
  record: PullRequestRecord
): Promise<string> {
  const recordPath = await getPullRequestPath(worktreePath);
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return recordPath;
}
