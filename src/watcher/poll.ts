import type { WatcherSource } from '../config/types.js';
import type { GhRunner, RepoRef } from '../workflow/state-store.js';

export interface WatchIssue {
  number: number;
  title: string;
  updatedAt: string;
  labels: string[];
  assignees: string[];
}

export interface PollInput {
  repo: RepoRef;
  source: WatcherSource;
  since: string;
  triggerLabel: string;
  gh: GhRunner;
  onWarn?: (message: string) => void;
}

export interface PollResult {
  issues: WatchIssue[];
  rateLimited: boolean;
  error?: string;
}

interface GhIssueJson {
  number: number;
  title?: string;
  updatedAt: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
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

function buildIssueListArgs(input: PollInput): string[] {
  const base = [
    'issue',
    'list',
    '--repo',
    `${input.repo.owner}/${input.repo.repo}`,
    '--state',
    'open'
  ];

  if (input.source === 'assigned-to-me') {
    return [
      ...base,
      '--assignee',
      '@me',
      '--json',
      'number,title,updatedAt,labels,assignees',
      '--limit',
      '100'
    ];
  }

  return [
    ...base,
    '--search',
    buildIssueSearchQuery(input.since, input.triggerLabel),
    '--json',
    'number,title,updatedAt,labels,assignees',
    '--limit',
    '100'
  ];
}

function toWatchIssue(issue: GhIssueJson): WatchIssue {
  return {
    number: issue.number,
    title: issue.title ?? '',
    updatedAt: issue.updatedAt,
    labels: (issue.labels ?? []).flatMap((label) => (label.name ? [label.name] : [])),
    assignees: (issue.assignees ?? []).flatMap((assignee) => (assignee.login ? [assignee.login] : []))
  };
}

export async function pollIssues(input: PollInput): Promise<PollResult> {
  const result = await input.gh(buildIssueListArgs(input));
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
    .filter(
      (issue) =>
        input.source === 'assigned-to-me' ||
        (issue.labels ?? []).some((label) => label.name === input.triggerLabel)
    )
    .map(toWatchIssue);

  return { issues, rateLimited: false };
}
