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
