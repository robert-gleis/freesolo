import { execa } from 'execa';

import { slugifyIssueTitle } from './slug.js';
import type { IssueSummary, RepoContext, RepoRef } from './types.js';

interface GitHubIssueJson {
  id: string;
  number: number;
  title: string;
  body?: string;
  url: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
  state?: string;
}

interface GitHubIssueStatusNodeJson {
  id?: string | null;
  projectItems?: {
    nodes?: Array<{
      fieldValueByName?: {
        name?: string | null;
      } | null;
    } | null> | null;
  } | null;
}

interface GitHubIssueStatusResponseJson {
  data?: {
    nodes?: Array<GitHubIssueStatusNodeJson | null> | null;
  } | null;
}

const STATUS_ORDER = new Map([
  ['in progress', 0],
  ['todo', 1],
  ['done', 2]
]);

const issueStatusQuery = `
  query($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Issue {
        id
        projectItems(first: 20) {
          nodes {
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
              }
            }
          }
        }
      }
    }
  }
`;

function normalizeStatus(status: string | null | undefined): string | null {
  const normalized = status?.trim();
  return normalized ? normalized : null;
}

function getIssueStatusRank(status: string | null): number {
  if (!status) {
    return 4;
  }

  return STATUS_ORDER.get(status.toLowerCase()) ?? 3;
}

function getIssueStatusTieBreaker(status: string | null): string {
  if (!status) {
    return '';
  }

  return STATUS_ORDER.has(status.toLowerCase()) ? '' : status.toLowerCase();
}

function getFirstProjectStatus(
  projectItems?: Array<{
    fieldValueByName?: {
      name?: string | null;
    } | null;
  } | null> | null
): string | null {
  for (const item of projectItems ?? []) {
    const status = normalizeStatus(item?.fieldValueByName?.name);

    if (status) {
      return status;
    }
  }

  return null;
}

export function buildIssueStatusLookup(nodes: Array<GitHubIssueStatusNodeJson | null | undefined>): Record<string, string | null> {
  return Object.fromEntries(
    nodes.flatMap((node) => {
      const id = typeof node?.id === 'string' ? node.id : null;
      const projectItems = node?.projectItems?.nodes;

      return id ? [[id, getFirstProjectStatus(projectItems)]] : [];
    })
  );
}

export function normalizeIssueList(
  issues: GitHubIssueJson[],
  statusesByIssueId: Record<string, string | null> = {}
): IssueSummary[] {
  return issues
    .filter((issue) => issue.state === undefined || issue.state.toUpperCase() === 'OPEN')
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      url: issue.url,
      labels: (issue.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
      assignees: (issue.assignees ?? []).map((assignee) => assignee.login ?? '').filter(Boolean),
      slug: slugifyIssueTitle(issue.title),
      status: normalizeStatus(statusesByIssueId[issue.id])
    }));
}

export function sortIssuesByStatus(issues: IssueSummary[]): IssueSummary[] {
  return [...issues].sort((left, right) => {
    const rankDiff = getIssueStatusRank(left.status) - getIssueStatusRank(right.status);

    if (rankDiff !== 0) {
      return rankDiff;
    }

    const statusDiff = getIssueStatusTieBreaker(left.status).localeCompare(getIssueStatusTieBreaker(right.status));

    if (statusDiff !== 0) {
      return statusDiff;
    }

    return left.number - right.number;
  });
}

async function fetchIssueStatusesById(issueIds: string[]): Promise<Record<string, string | null>> {
  if (issueIds.length === 0) {
    return {};
  }

  const args = ['api', 'graphql', '-f', `query=${issueStatusQuery}`];

  for (const issueId of issueIds) {
    args.push('-F', `ids[]=${issueId}`);
  }

  try {
    const { stdout } = await execa('gh', args);
    const response = JSON.parse(stdout) as GitHubIssueStatusResponseJson;

    return buildIssueStatusLookup(response.data?.nodes ?? []);
  } catch {
    return {};
  }
}

export async function listAssignedIssues(repo: RepoContext): Promise<IssueSummary[]> {
  let stdout: string;

  try {
    ({ stdout } = await execa('gh', [
      'issue',
      'list',
      '--repo',
      `${repo.owner}/${repo.repo}`,
      '--assignee',
      '@me',
      '--state',
      'open',
      '--json',
      'id,number,title,body,url,labels,assignees,state',
      '--limit',
      '100'
    ]));
  } catch {
    throw new Error('freesolo requires GitHub CLI access. Run `gh auth status` and retry.');
  }

  const issues = JSON.parse(stdout) as GitHubIssueJson[];
  const statusesByIssueId = await fetchIssueStatusesById(issues.map((issue) => issue.id));

  return sortIssuesByStatus(normalizeIssueList(issues, statusesByIssueId));
}

/** Runs `gh <args>` and returns raw stdout. Injectable for tests. */
export type GhRunner = (args: string[]) => Promise<string>;

export interface GetIssueBodyDeps {
  run?: GhRunner;
}

const defaultGhRunner: GhRunner = async (args) => {
  const { stdout } = await execa('gh', args);
  return stdout;
};

/**
 * Reads a single issue's body via `gh issue view <n> --json body`.
 *
 * Returns '' when the issue exists but has an empty body, and null when the
 * issue cannot be read at all (missing issue, gh failure, or unparseable
 * output) so callers can degrade gracefully instead of throwing.
 */
export async function getIssueBody(
  repo: RepoRef,
  issueNumber: number,
  deps: GetIssueBodyDeps = {}
): Promise<string | null> {
  const run = deps.run ?? defaultGhRunner;
  try {
    const stdout = await run([
      'issue',
      'view',
      String(issueNumber),
      '--repo',
      `${repo.owner}/${repo.repo}`,
      '--json',
      'body'
    ]);
    const parsed = JSON.parse(stdout) as { body?: string | null };
    return parsed.body ?? '';
  } catch {
    return null;
  }
}
