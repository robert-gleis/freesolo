import type { GhRunner, RepoRef } from '../workflow/state-store.js';

export interface TriagedIssue {
  number: number;
  updatedAt: string;
}

export interface PollInput {
  repo: RepoRef;
  since: string;
  triggerLabel: string;
  gh: GhRunner;
  onWarn?: (message: string) => void;
}

export interface PollResult {
  issues: TriagedIssue[];
  rateLimited: boolean;
  error?: string;
}

interface GhIssueJson {
  number: number;
  updatedAt: string;
  labels?: Array<{ name?: string }>;
}

export function buildIssueSearchQuery(since: string, triggerLabel: string): string {
  return `updated:>${since} label:${triggerLabel}`;
}

export function isRateLimitError(exitCode: number, stderr: string): boolean {
  if (exitCode === 0) return false;
  const lower = stderr.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('http 403') ||
    lower.includes('http 429') ||
    lower.includes(' 403') ||
    lower.includes(' 429')
  );
}

export async function pollTriagedIssues(input: PollInput): Promise<PollResult> {
  const args = [
    'issue',
    'list',
    '--repo',
    `${input.repo.owner}/${input.repo.repo}`,
    '--state',
    'open',
    '--search',
    buildIssueSearchQuery(input.since, input.triggerLabel),
    '--json',
    'number,updatedAt,labels',
    '--limit',
    '100'
  ];

  const result = await input.gh(args);
  if (result.exitCode !== 0) {
    if (isRateLimitError(result.exitCode, result.stderr)) {
      return { issues: [], rateLimited: true };
    }
    const message = result.stderr.trim() || `gh issue list exited ${result.exitCode}`;
    return { issues: [], rateLimited: false, error: message };
  }

  let raw: GhIssueJson[];
  try {
    raw = JSON.parse(result.stdout) as GhIssueJson[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { issues: [], rateLimited: false, error: `failed to parse gh output: ${message}` };
  }

  if (raw.length === 100) {
    input.onWarn?.(
      'gh issue list returned 100 results (pagination limit). Processing all; cursor advance on next poll prevents re-processing.'
    );
  }

  const issues = raw
    .filter((issue) => (issue.labels ?? []).some((label) => label.name === input.triggerLabel))
    .map((issue) => ({ number: issue.number, updatedAt: issue.updatedAt }));

  return { issues, rateLimited: false };
}
