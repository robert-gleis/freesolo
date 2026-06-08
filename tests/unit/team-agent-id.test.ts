import { describe, expect, it } from 'vitest';

import { buildAgentId, slugifyRoleName } from '../../src/team/agent-id.js';

describe('slugifyRoleName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyRoleName('Backend Engineer')).toBe('backend-engineer');
  });

  it('collapses repeated separators', () => {
    expect(slugifyRoleName('QA / Reviewer')).toBe('qa-reviewer');
  });
});

describe('buildAgentId', () => {
  it('formats agent-{issue}-{role}-{index}', () => {
    expect(buildAgentId(42, 'Backend Engineer', 1)).toBe('agent-42-backend-engineer-1');
  });
});
