import { execa } from 'execa';

import { slugifyIssueTitle } from './slug.js';
import type { IssueSummary, RepoContext } from './types.js';

interface GitHubIssueJson {
  number: number;
  title: string;
  body?: string;
  url: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
}

export function normalizeIssueList(issues: GitHubIssueJson[]): IssueSummary[] {
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    url: issue.url,
    labels: (issue.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
    assignees: (issue.assignees ?? []).map((assignee) => assignee.login ?? '').filter(Boolean),
    slug: slugifyIssueTitle(issue.title)
  }));
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
      'number,title,body,url,labels,assignees,state',
      '--limit',
      '100'
    ]));
  } catch {
    throw new Error('issueflow requires GitHub CLI access. Run `gh auth status` and retry.');
  }

  return normalizeIssueList(JSON.parse(stdout) as GitHubIssueJson[]);
}
