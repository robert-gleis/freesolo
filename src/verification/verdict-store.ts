import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { RepoRef } from '../core/types.js';
import type { GhRunner } from '../core/gh.js';

export const VERDICT_LABEL_PREFIX = 'verification:';

export type VerdictStatus = 'pass' | 'fail';

export interface GateVerdictRecord {
  schemaVersion: 1;
  issueNumber: number;
  runId: string | null;
  outcome: 'pass' | 'fail' | 'no-run';
  reason: string;
  nextAction: string;
  evaluatedAt: string;
}

export interface VerdictStoreDeps {
  gh?: GhRunner;
}

export class MultipleVerdictLabelsError extends Error {
  readonly issueNumber: number;
  readonly labels: string[];

  constructor(issueNumber: number, labels: string[]) {
    super(
      `Issue #${issueNumber} has multiple verification verdict labels: ${labels.join(', ')}. Repair manually before retrying.`
    );
    this.name = 'MultipleVerdictLabelsError';
    this.issueNumber = issueNumber;
    this.labels = labels;
  }
}

function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function verdictLabelFor(status: VerdictStatus): string {
  return `${VERDICT_LABEL_PREFIX}${status}`;
}

interface IssueLabelsResponse {
  labels?: Array<{ name?: string }>;
}

const VERDICT_LABEL_COLORS: Record<VerdictStatus, string> = {
  pass: '0E8A16',
  fail: 'B60205'
};

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

async function createVerdictLabel(repo: RepoRef, status: VerdictStatus, gh: GhRunner): Promise<void> {
  const result = await gh([
    'label',
    'create',
    verdictLabelFor(status),
    '--repo',
    repoSlug(repo),
    '--color',
    VERDICT_LABEL_COLORS[status],
    '--description',
    `IssueFlow verification verdict: ${status}`,
    '--force'
  ]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to create label ${verdictLabelFor(status)}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }
}

export async function readVerdict(
  repo: RepoRef,
  issueNumber: number,
  deps: VerdictStoreDeps = {}
): Promise<VerdictStatus | null> {
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
    throw new Error(
      `Failed to read labels for issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }

  let payload: IssueLabelsResponse;
  try {
    payload = JSON.parse(result.stdout || '{}') as IssueLabelsResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse \`gh issue view\` output for issue #${issueNumber}: ${message}`);
  }

  const labelNames = (payload.labels ?? []).map((l) => l.name ?? '');
  const verdictLabels = labelNames.filter((name) => name.startsWith(VERDICT_LABEL_PREFIX));

  if (verdictLabels.length > 1) {
    throw new MultipleVerdictLabelsError(issueNumber, verdictLabels);
  }

  if (verdictLabels.length === 0) {
    return null;
  }

  const candidate = verdictLabels[0].slice(VERDICT_LABEL_PREFIX.length);
  return candidate === 'pass' || candidate === 'fail' ? candidate : null;
}

export async function writeVerdict(
  repo: RepoRef,
  issueNumber: number,
  from: VerdictStatus | null,
  to: VerdictStatus,
  deps: VerdictStoreDeps = {}
): Promise<void> {
  const gh = deps.gh ?? defaultRunner;

  await createVerdictLabel(repo, to, gh);

  const editArgs = [
    'issue',
    'edit',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--add-label',
    verdictLabelFor(to)
  ];

  if (from !== null) {
    editArgs.push('--remove-label', verdictLabelFor(from));
  }

  const result = await gh(editArgs);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to swap verdict labels on issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }
}

async function gitIssueflowPath(repoRoot: string, ...segments: string[]): Promise<string> {
  const joined = ['issueflow', ...segments].join('/');
  const { stdout } = await execa('git', ['rev-parse', '--git-path', joined], { cwd: repoRoot });
  const resolved = stdout.trim();
  return path.isAbsolute(resolved) ? resolved : path.join(repoRoot, resolved);
}

async function getGateVerdictPath(repoRoot: string, issueNumber: number): Promise<string> {
  return gitIssueflowPath(repoRoot, 'verifications', `issue-${issueNumber}`, 'gate-verdict.json');
}

export async function writeGateVerdictRecord(
  repoRoot: string,
  issueNumber: number,
  record: GateVerdictRecord
): Promise<void> {
  const filePath = await getGateVerdictPath(repoRoot, issueNumber);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(record, null, 2));
}

export async function readGateVerdictRecord(
  repoRoot: string,
  issueNumber: number
): Promise<GateVerdictRecord | null> {
  const filePath = await getGateVerdictPath(repoRoot, issueNumber);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as GateVerdictRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}
