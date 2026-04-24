import { describe, expect, it } from 'vitest';

import { slugifyIssueTitle } from '../../src/core/slug.js';

describe('slugifyIssueTitle', () => {
  it('normalizes titles into lowercase dash-separated slugs', () => {
    expect(slugifyIssueTitle('Add Cursor / Claude Bootstrap!')).toBe('add-cursor-claude-bootstrap');
  });
});
