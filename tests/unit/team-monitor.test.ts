import { describe, expect, it } from 'vitest';

import {
  isMemberBlockedTooLong,
  isMemberInactive,
  isTeamComplete,
  isTeamTimedOut
} from '../../src/teams/monitor.js';

describe('isMemberInactive', () => {
  it('returns true when lastActivityAt is older than timeout', () => {
    const now = new Date('2026-06-08T12:00:00Z');
    const last = new Date('2026-06-08T11:00:00Z');
    expect(isMemberInactive({ state: 'running', lastActivityAt: last }, undefined, now, 30_000)).toBe(
      true
    );
  });
});

describe('isTeamComplete', () => {
  it('returns true when every member is stopped', () => {
    expect(isTeamComplete(['stopped', 'stopped'])).toBe(true);
    expect(isTeamComplete(['running', 'stopped'])).toBe(false);
  });
});

describe('isTeamTimedOut', () => {
  it('returns true when elapsed time exceeds team timeout', () => {
    const startedAt = new Date('2026-06-08T11:00:00Z');
    const now = new Date('2026-06-08T12:00:00Z');
    expect(isTeamTimedOut(startedAt, now, 30 * 60 * 1000)).toBe(true);
  });
});

describe('isMemberBlockedTooLong', () => {
  it('returns true when blocked duration exceeds timeout', () => {
    const blockedAt = new Date('2026-06-08T11:00:00Z');
    const now = new Date('2026-06-08T12:00:00Z');
    expect(isMemberBlockedTooLong(blockedAt, now, 30 * 60 * 1000)).toBe(true);
  });
});
