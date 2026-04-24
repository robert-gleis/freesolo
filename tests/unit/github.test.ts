import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/gh/issues.json' with { type: 'json' };
import { normalizeIssueList } from '../../src/core/github.js';

describe('normalizeIssueList', () => {
  it('adds normalized labels, assignees, and slugs', () => {
    const [issue] = normalizeIssueList(fixture);

    expect(issue.number).toBe(12);
    expect(issue.labels).toEqual(['workflow']);
    expect(issue.assignees).toContain('robert-gleis');
    expect(issue.slug).toBe('ship-issueflow-start');
  });
});
