import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';
import { z } from 'zod';

import { getIssueflowPath } from '../core/session-state.js';
import type { RepoRef } from '../core/types.js';
import type { GhRunner } from '../core/gh.js';
import {
  MergeReadinessError,
  type MergeLabelStatus,
  type MergeReadinessRecord
} from './merge-types.js';

export const MERGE_LABEL_PREFIX = 'merge:';

const MERGE_LABEL_COLORS: Record<MergeLabelStatus, string> = {
  ready: '1D76DB',
  blocked: 'D93F0B'
};

export class MultipleMergeLabelVerdictsError extends Error {
  readonly issueNumber: number;
  readonly labels: string[];

  constructor(issueNumber: number, labels: string[]) {
    super(
      `Issue #${issueNumber} has multiple merge readiness labels: ${labels.join(', ')}. Repair manually before retrying.`
    );
    this.name = 'MultipleMergeLabelVerdictsError';
    this.issueNumber = issueNumber;
    this.labels = labels;
  }
}

const mergeReadinessRecordSchema = z.object({
  schemaVersion: z.literal(1),
  issueNumber: z.number().int().positive(),
  outcome: z.enum(['ready', 'blocked']),
  checks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(['pass', 'fail', 'skip']),
      detail: z.string()
    })
  ),
  verificationRunId: z.string().nullable(),
  pullRequestNumber: z.number().int().positive().nullable(),
  prCommentId: z.string().nullable(),
  reason: z.string(),
  nextAction: z.string(),
  evaluatedAt: z.string(),
  mergedAt: z.string().optional()
});

function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function mergeLabelFor(status: MergeLabelStatus): string {
  return `${MERGE_LABEL_PREFIX}${status}`;
}

const defaultRunner: GhRunner = async (args) => {
  try {
    const result = await execa('gh', args);
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0
    };
  } catch (error) {
    const e = error as { exitCode?: number; stdout?: string; stderr?: string };
    if (e?.exitCode === undefined) {
      throw new Error('issueflow requires GitHub CLI access. Run `gh auth status` and retry.');
    }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', exitCode: e.exitCode };
  }
};

export interface MergeStoreDeps {
  gh?: GhRunner;
}

export async function getMergeReadinessPath(worktreePath: string): Promise<string> {
  const rawPath = await getIssueflowPath(worktreePath, 'merge-readiness.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

function parseRecord(contents: string): MergeReadinessRecord {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new MergeReadinessError('invalid-record', 'merge readiness record is not valid JSON');
  }

  const result = mergeReadinessRecordSchema.safeParse(parsed);
  if (!result.success) {
    throw new MergeReadinessError('invalid-record', result.error.message);
  }

  return result.data;
}

export async function readMergeReadinessRecord(
  worktreePath: string
): Promise<MergeReadinessRecord | null> {
  const recordPath = await getMergeReadinessPath(worktreePath);

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

export async function writeMergeReadinessRecord(
  worktreePath: string,
  record: MergeReadinessRecord
): Promise<string> {
  const recordPath = await getMergeReadinessPath(worktreePath);
  await fs.mkdir(path.dirname(recordPath), { recursive: true });
  await fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  return recordPath;
}

interface IssueLabelsResponse {
  labels?: Array<{ name?: string }>;
}

export async function readMergeLabelStatus(
  repo: RepoRef,
  issueNumber: number,
  deps: MergeStoreDeps = {}
): Promise<MergeLabelStatus | null> {
  const gh = deps.gh ?? defaultRunner;
  const result = await gh([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--json',
    'labels'
  ]);

  if (result.exitCode !== 0) {
    throw new MergeReadinessError(
      'gh-error',
      `Failed to read labels for issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }

  let payload: IssueLabelsResponse;
  try {
    payload = JSON.parse(result.stdout || '{}') as IssueLabelsResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MergeReadinessError(
      'gh-error',
      `Failed to parse \`gh issue view\` output for issue #${issueNumber}: ${message}`
    );
  }

  const labelNames = (payload.labels ?? []).map((l) => l.name ?? '');
  const mergeLabels = labelNames.filter((name) => name.startsWith(MERGE_LABEL_PREFIX));

  if (mergeLabels.length > 1) {
    throw new MultipleMergeLabelVerdictsError(issueNumber, mergeLabels);
  }

  if (mergeLabels.length === 0) {
    return null;
  }

  const candidate = mergeLabels[0].slice(MERGE_LABEL_PREFIX.length);
  return candidate === 'ready' || candidate === 'blocked' ? candidate : null;
}

async function createMergeLabel(
  repo: RepoRef,
  status: MergeLabelStatus,
  gh: GhRunner
): Promise<void> {
  const result = await gh([
    'label',
    'create',
    mergeLabelFor(status),
    '--repo',
    repoSlug(repo),
    '--color',
    MERGE_LABEL_COLORS[status],
    '--description',
    `IssueFlow merge readiness: ${status}`,
    '--force'
  ]);

  if (result.exitCode !== 0) {
    throw new MergeReadinessError(
      'gh-error',
      `Failed to create label ${mergeLabelFor(status)}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }
}

export async function writeMergeLabelVerdict(
  repo: RepoRef,
  issueNumber: number,
  from: MergeLabelStatus | null,
  to: MergeLabelStatus,
  deps: MergeStoreDeps = {}
): Promise<void> {
  const gh = deps.gh ?? defaultRunner;

  await createMergeLabel(repo, to, gh);

  const editArgs = [
    'issue',
    'edit',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--add-label',
    mergeLabelFor(to)
  ];

  if (from !== null) {
    editArgs.push('--remove-label', mergeLabelFor(from));
  }

  const result = await gh(editArgs);

  if (result.exitCode !== 0) {
    throw new MergeReadinessError(
      'gh-error',
      `Failed to swap merge labels on issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }
}
