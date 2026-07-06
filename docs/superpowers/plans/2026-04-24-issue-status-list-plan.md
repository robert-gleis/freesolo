# Issue Status List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the GitHub Project `Status` in the interactive issue picker for `freesolo start` and sort open assigned issues by status group.

**Architecture:** Keep `gh issue list` as the repo-scoped source of open assigned issues, then enrich those issues with Project `Status` values through a focused GraphQL lookup keyed by issue node IDs. Build a small status-lookup helper in the GitHub core layer, normalize the lookup into `IssueSummary`, sort there, and render the picker label from a small formatting helper in the start command.

**Tech Stack:** TypeScript, `execa`, GitHub CLI (`gh`), Vitest, Inquirer

---

### Task 1: Add failing tests for status normalization, sorting, and picker labels

**Files:**
- Modify: `tests/unit/github.test.ts`
- Create: `tests/unit/start.test.ts`
- Reference: `tests/fixtures/gh/issues.json`

- [ ] **Step 1: Write the failing GitHub normalization and sorting tests**

```ts
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
  it('adds normalized labels, assignees, slugs, and project status', () => {
    const [issue] = normalizeIssueList(fixture, { ISSUE_12: 'In Progress' });

    expect(issue.status).toBe('In Progress');
  });

  it('falls back to null when no project status exists', () => {
    const [issue] = normalizeIssueList([
      {
        id: 'ISSUE_99',
        number: 99,
        title: 'Missing status',
        body: '',
        url: 'https://github.com/example/repo/issues/99',
        labels: [],
        assignees: []
      }
    ], {});

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
```

- [ ] **Step 2: Run the GitHub unit tests to verify RED**

Run: `rtk npm test -- tests/unit/github.test.ts`
Expected: FAIL because the GitHub core layer does not expose `buildIssueStatusLookup`, `IssueSummary` and `normalizeIssueList` do not expose `status`, and `sortIssuesByStatus` does not exist yet.

- [ ] **Step 3: Write the failing picker-label test**

```ts
import { describe, expect, it } from 'vitest';

import { buildIssueChoiceLabel } from '../../src/commands/start.js';

describe('buildIssueChoiceLabel', () => {
  it('shows the project status ahead of the issue number and title', () => {
    expect(
      buildIssueChoiceLabel({
        number: 42,
        title: 'Improve issue picker',
        body: '',
        url: 'https://github.com/example/repo/issues/42',
        labels: [],
        assignees: [],
        slug: 'improve-issue-picker',
        status: 'In Progress'
      })
    ).toBe('[In Progress] #42 Improve issue picker');
  });

  it('shows No Status when no project status is present', () => {
    expect(
      buildIssueChoiceLabel({
        number: 61,
        title: 'Clean up docs',
        body: '',
        url: 'https://github.com/example/repo/issues/61',
        labels: [],
        assignees: [],
        slug: 'clean-up-docs',
        status: null
      })
    ).toBe('[No Status] #61 Clean up docs');
  });
});
```

- [ ] **Step 4: Run the picker-label tests to verify RED**

Run: `rtk npm test -- tests/unit/start.test.ts`
Expected: FAIL because `buildIssueChoiceLabel` is not exported yet.

### Task 2: Implement status enrichment and sorting in the GitHub core layer

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/github.ts`
- Reference: `tests/unit/github.test.ts`

- [ ] **Step 1: Add the minimal type shape for issue status support**

```ts
export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  assignees: string[];
  slug: string;
  status: string | null;
}
```

- [ ] **Step 2: Implement status extraction and status-first sorting**

```ts
export function buildIssueStatusLookup(nodes: GitHubIssueStatusNodeJson[]): Record<string, string | null> {
  return Object.fromEntries(
    nodes
      .filter((node): node is GitHubIssueStatusNodeJson => Boolean(node?.id))
      .map((node) => [
        node.id,
        node.projectItems?.nodes
          ?.map((item) => item.fieldValueByName?.name ?? null)
          .find((status): status is string => Boolean(status && status.trim())) ?? null
      ])
  );
}

export function sortIssuesByStatus(issues: IssueSummary[]): IssueSummary[] {
  return [...issues].sort((left, right) => {
    const rankDiff = getStatusRank(left.status) - getStatusRank(right.status);
    if (rankDiff !== 0) return rankDiff;

    const statusDiff = getStatusSortLabel(left.status).localeCompare(getStatusSortLabel(right.status));
    if (statusDiff !== 0) return statusDiff;

    return left.number - right.number;
  });
}
```

- [ ] **Step 3: Enrich the issue list with project status before returning it**

```ts
export function normalizeIssueList(
  issues: GitHubIssueJson[],
  statusesByIssueId: Record<string, string | null> = {}
): IssueSummary[] {
  return issues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body ?? '',
    url: issue.url,
    labels: (issue.labels ?? []).map((label) => label.name ?? '').filter(Boolean),
    assignees: (issue.assignees ?? []).map((assignee) => assignee.login ?? '').filter(Boolean),
    slug: slugifyIssueTitle(issue.title),
    status: statusesByIssueId[issue.id] ?? null
  }));
}
```

- [ ] **Step 4: Add the GraphQL status lookup and return sorted issues from the GitHub loader**

```ts
const issues = JSON.parse(stdout) as GitHubIssueJson[];
const statusesByIssueId = await fetchIssueStatusesById(issues.map((issue) => issue.id));

return sortIssuesByStatus(normalizeIssueList(issues, statusesByIssueId));
```

- [ ] **Step 5: Run the GitHub unit tests to verify GREEN**

Run: `rtk npm test -- tests/unit/github.test.ts`
Expected: PASS

### Task 3: Render the status in the interactive picker

**Files:**
- Modify: `src/commands/start.ts`
- Reference: `tests/unit/start.test.ts`

- [ ] **Step 1: Add a small label-formatting helper**

```ts
export function buildIssueChoiceLabel(issue: IssueSummary): string {
  return `[${issue.status ?? 'No Status'}] #${issue.number} ${issue.title}`;
}
```

- [ ] **Step 2: Use the helper in the default picker choices**

```ts
choices: issues.map((issue) => ({
  name: buildIssueChoiceLabel(issue),
  value: issue
}))
```

- [ ] **Step 3: Run the picker-label tests to verify GREEN**

Run: `rtk npm test -- tests/unit/start.test.ts`
Expected: PASS

### Task 4: Run focused and broad verification

**Files:**
- Modify: `tests/integration/start-command.test.ts`

- [ ] **Step 1: Add or update one integration-level expectation for sorted issues flowing through `createStartPlan`**

```ts
chooseIssue: async (issues) => {
  expect(issues.map((issue) => issue.status)).toEqual(['In Progress', 'Todo', 'Done', null]);
  return issues[0];
}
```

- [ ] **Step 2: Run the focused command-start coverage**

Run: `rtk npm test -- tests/unit/github.test.ts tests/unit/start.test.ts tests/integration/start-command.test.ts`
Expected: PASS

- [ ] **Step 3: Run the full suite**

Run: `rtk npm test`
Expected: PASS
