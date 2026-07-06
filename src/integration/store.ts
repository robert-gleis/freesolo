import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { getFreesoloPath } from '../core/session-state.js';
import { CandidateBranchError, type CandidateBranchRecord } from './types.js';

const candidateBranchSourceSchema = z.object({
  branchName: z.string().min(1),
  ownerKind: z.enum(['agent', 'team']),
  ownerId: z.string().min(1)
});

export const candidateBranchRecordSchema = z.object({
  branchName: z.string().min(1),
  issueNumber: z.number().int().positive(),
  issueSlug: z.string().min(1),
  teamId: z.string().min(1),
  sources: z.array(candidateBranchSourceSchema).min(1),
  baseBranch: z.string().min(1),
  mergeCommitSha: z.string().nullable(),
  status: z.enum(['ready', 'conflict']),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export async function getCandidateBranchPath(worktreePath: string): Promise<string> {
  const rawPath = await getFreesoloPath(worktreePath, 'candidate-branch.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

function parseRecord(contents: string): CandidateBranchRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new CandidateBranchError('invalid-record', 'candidate branch record is not valid JSON');
  }

  const result = candidateBranchRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new CandidateBranchError('invalid-record', result.error.message);
  }

  return result.data;
}

export async function readCandidateBranchRecord(worktreePath: string): Promise<CandidateBranchRecord | null> {
  const recordPath = await getCandidateBranchPath(worktreePath);

  try {
    const contents = await fs.readFile(recordPath, 'utf8');
    return parseRecord(contents);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    if (error instanceof CandidateBranchError) {
      throw error;
    }

    throw error;
  }
}

export async function writeCandidateBranchRecord(
  worktreePath: string,
  record: CandidateBranchRecord
): Promise<string> {
  const recordPath = await getCandidateBranchPath(worktreePath);
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return recordPath;
}

export async function clearCandidateBranchRecord(worktreePath: string): Promise<void> {
  const recordPath = await getCandidateBranchPath(worktreePath);
  try {
    await fs.unlink(recordPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
