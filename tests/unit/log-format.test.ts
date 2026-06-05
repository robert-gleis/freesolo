import { describe, expect, it } from 'vitest';

import { buildCombined } from '../../src/runners/log-format.js';

describe('buildCombined', () => {
  it('joins both streams with tags when both are non-empty', () => {
    expect(buildCombined('hello\n', 'oops\n')).toBe('[stdout]\nhello\n\n[stderr]\noops\n');
  });

  it('returns only stdout tag when stderr is empty', () => {
    expect(buildCombined('only out', '')).toBe('[stdout]\nonly out');
  });

  it('returns only stderr tag when stdout is empty', () => {
    expect(buildCombined('', 'only err')).toBe('[stderr]\nonly err');
  });

  it('returns empty string when both are empty', () => {
    expect(buildCombined('', '')).toBe('');
  });
});
