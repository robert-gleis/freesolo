import { describe, expect, it, vi } from 'vitest';

import { buildIssueSearchQuery, isRateLimitError, pollTriagedIssues } from '../../src/watcher/poll.js';
import type { GhRunner } from '../../src/workflow/state-store.js';

const repo = { owner: 'acme', repo: 'widgets' };

function buildRunner(reply: () => { stdout?: string; stderr?: string; exitCode?: number }): GhRunner {
  return async () => {
    const result = reply();
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0
    };
  };
}

describe('buildIssueSearchQuery', () => {
  it('includes since and label', () => {
    expect(buildIssueSearchQuery('2026-06-01T00:00:00Z', 'state:triaged')).toBe(
      'updated:>2026-06-01T00:00:00Z label:state:triaged'
    );
  });
});

describe('isRateLimitError', () => {
  it('detects 403 and 429', () => {
    expect(isRateLimitError(1, 'API rate limit exceeded')).toBe(true);
    expect(isRateLimitError(1, 'HTTP 403')).toBe(true);
    expect(isRateLimitError(1, 'not found')).toBe(false);
  });
});

describe('pollTriagedIssues', () => {
  it('returns issues with trigger label', async () => {
    const gh = buildRunner(() => ({
      stdout: JSON.stringify([
        { number: 1, updatedAt: '2026-06-02T10:00:00Z', labels: [{ name: 'state:triaged' }] },
        { number: 2, updatedAt: '2026-06-02T11:00:00Z', labels: [{ name: 'bug' }] }
      ])
    }));

    const result = await pollTriagedIssues({
      repo,
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      gh
    });

    expect(result.rateLimited).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.issues).toEqual([{ number: 1, updatedAt: '2026-06-02T10:00:00Z' }]);
  });

  it('sets rateLimited on gh failure', async () => {
    const gh = buildRunner(() => ({ exitCode: 1, stderr: 'HTTP 429: rate limit' }));
    const result = await pollTriagedIssues({
      repo,
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      gh
    });
    expect(result.rateLimited).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.issues).toEqual([]);
  });

  it('returns error on non-rate-limit gh failure', async () => {
    const gh = buildRunner(() => ({ exitCode: 1, stderr: 'HTTP 401: Bad credentials' }));
    const result = await pollTriagedIssues({
      repo,
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      gh
    });
    expect(result.rateLimited).toBe(false);
    expect(result.error).toContain('401');
    expect(result.issues).toEqual([]);
  });

  it('returns error on malformed gh stdout', async () => {
    const gh = buildRunner(() => ({ stdout: 'not json' }));
    const result = await pollTriagedIssues({
      repo,
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      gh
    });
    expect(result.error).toMatch(/parse gh output/i);
    expect(result.issues).toEqual([]);
  });

  it('warns when result count hits pagination limit', async () => {
    const issues = Array.from({ length: 100 }, (_, i) => ({
      number: i + 1,
      updatedAt: '2026-06-02T10:00:00Z',
      labels: [{ name: 'state:triaged' }]
    }));
    const gh = buildRunner(() => ({ stdout: JSON.stringify(issues) }));
    const onWarn = vi.fn();

    await pollTriagedIssues({
      repo,
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      gh,
      onWarn
    });

    expect(onWarn).toHaveBeenCalledWith(
      expect.stringMatching(/100.*pagination|limit.*100/i)
    );
  });
});
