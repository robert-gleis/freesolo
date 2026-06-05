import { describe, expect, it } from 'vitest';

import { sanitizeSessionName, sessionNameForRunnerId } from '../../src/runners/tmux-command.js';

describe('sessionNameForRunnerId', () => {
  it('prefixes and lowercases the id', () => {
    expect(sessionNameForRunnerId('Planner-1')).toBe('issueflow-planner-1');
  });

  it('replaces invalid characters with hyphens', () => {
    expect(sessionNameForRunnerId('foo/bar_baz')).toBe('issueflow-foo-bar-baz');
  });

  it('collapses repeated hyphens', () => {
    expect(sessionNameForRunnerId('a---b')).toBe('issueflow-a-b');
  });
});

describe('sanitizeSessionName', () => {
  it('trims leading and trailing hyphens from the sanitized segment', () => {
    expect(sanitizeSessionName('--foo--')).toBe('foo');
  });

  it('truncates the sanitized segment to 200 chars (before issueflow- prefix)', () => {
    const longId = 'a'.repeat(201);
    const name = sessionNameForRunnerId(longId);
    expect(name.length).toBeLessThanOrEqual(210);
    expect(name).toMatch(/^issueflow-a{200}$/);
  });
});
