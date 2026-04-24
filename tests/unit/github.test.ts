import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/gh/issues.json' with { type: 'json' };
import { buildIssueStatusLookup, normalizeIssueList, sortIssuesByStatus } from '../../src/core/github.js';

describe('buildIssueStatusLookup', () => {
  it('uses the first non-empty project status for each issue id', () => {
    expect(
      buildIssueStatusLookup([
        {
          id: 'ISSUE_12',
          projectItems: {
            nodes: [
              { fieldValueByName: { name: 'In Progress' } },
              { fieldValueByName: { name: 'Done' } }
            ]
          }
        }
      ])
    ).toEqual({ ISSUE_12: 'In Progress' });
  });
});

describe('normalizeIssueList', () => {
  it('adds normalized labels, assignees, slugs, and status', () => {
    const [issue] = normalizeIssueList(fixture, { ISSUE_12: 'In Progress' });

    expect(issue.number).toBe(12);
    expect(issue.labels).toEqual(['workflow']);
    expect(issue.assignees).toContain('robert-gleis');
    expect(issue.slug).toBe('ship-issueflow-start');
    expect(issue.status).toBe('In Progress');
  });

  it('falls back to null when no project status exists', () => {
    const [issue] = normalizeIssueList(
      [
        {
          id: 'ISSUE_99',
          number: 99,
          title: 'Missing status',
          body: '',
          url: 'https://github.com/example/repo/issues/99',
          labels: [],
          assignees: []
        }
      ],
      {}
    );

    expect(issue.status).toBeNull();
  });
});

describe('sortIssuesByStatus', () => {
  it('orders active work ahead of done and missing status', () => {
    const sorted = sortIssuesByStatus([
      { number: 4, title: 'No status', body: '', url: '', labels: [], assignees: [], slug: 'no-status', status: null },
      { number: 3, title: 'Done', body: '', url: '', labels: [], assignees: [], slug: 'done', status: 'Done' },
      { number: 2, title: 'Todo', body: '', url: '', labels: [], assignees: [], slug: 'todo', status: 'Todo' },
      { number: 1, title: 'In Progress', body: '', url: '', labels: [], assignees: [], slug: 'in-progress', status: 'In Progress' }
    ]);

    expect(sorted.map((issue) => issue.number)).toEqual([1, 2, 3, 4]);
  });
});
