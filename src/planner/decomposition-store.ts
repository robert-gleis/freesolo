import fs from 'node:fs/promises';
import path from 'node:path';

import { getIssueflowPath } from '../core/session-state.js';
import {
  decompositionPlanSchema,
  type DecompositionPlan
} from './schemas/decomposition-plan.js';

export class DecompositionNotFoundError extends Error {
  constructor(planPath: string) {
    super(`decomposition preview not found: ${planPath}`);
    this.name = 'DecompositionNotFoundError';
  }
}

export class DecompositionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecompositionValidationError';
  }
}

export class DecompositionAlreadyAppliedError extends Error {
  constructor() {
    super('decomposition has already been applied; cannot regenerate preview');
    this.name = 'DecompositionAlreadyAppliedError';
  }
}

export interface DecompositionAppliedRecord {
  parent_issue: number;
  applied_at: string;
  children: Array<{ number: number; title: string; url: string }>;
}

export async function getDecompositionPath(worktreePath: string): Promise<string> {
  const rawPath = await getIssueflowPath(worktreePath, 'decomposition.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

export async function getDecompositionAppliedPath(worktreePath: string): Promise<string> {
  const rawPath = await getIssueflowPath(worktreePath, 'decomposition-applied.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

export function validateDecompositionFile(contents: string): DecompositionPlan {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new DecompositionValidationError('decomposition file is not valid JSON');
  }

  const result = decompositionPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw new DecompositionValidationError(result.error.message);
  }
  return result.data;
}

export function assertParentIssueMatches(
  plan: DecompositionPlan,
  issueNumber: number
): DecompositionPlan {
  if (plan.parent_issue !== issueNumber) {
    throw new DecompositionValidationError(
      `decomposition parent_issue ${plan.parent_issue} does not match issue #${issueNumber}`
    );
  }
  return plan;
}

export async function writeDecomposition(
  worktreePath: string,
  plan: DecompositionPlan
): Promise<string> {
  const decompositionPath = await getDecompositionPath(worktreePath);
  await fs.mkdir(path.dirname(decompositionPath), { recursive: true });
  await fs.writeFile(decompositionPath, `${JSON.stringify(plan, null, 2)}\n`);
  return decompositionPath;
}

export async function readDecomposition(worktreePath: string): Promise<DecompositionPlan> {
  const decompositionPath = await getDecompositionPath(worktreePath);
  let contents: string;
  try {
    contents = await fs.readFile(decompositionPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new DecompositionNotFoundError(decompositionPath);
    }
    throw error;
  }
  return validateDecompositionFile(contents);
}

export async function readDecompositionApplied(
  worktreePath: string
): Promise<DecompositionAppliedRecord | null> {
  const appliedPath = await getDecompositionAppliedPath(worktreePath);
  try {
    const contents = await fs.readFile(appliedPath, 'utf8');
    return JSON.parse(contents) as DecompositionAppliedRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeDecompositionApplied(
  worktreePath: string,
  record: DecompositionAppliedRecord
): Promise<string> {
  const appliedPath = await getDecompositionAppliedPath(worktreePath);
  await fs.mkdir(path.dirname(appliedPath), { recursive: true });
  await fs.writeFile(appliedPath, `${JSON.stringify(record, null, 2)}\n`);
  return appliedPath;
}
