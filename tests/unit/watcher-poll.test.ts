import { describe, expect, it, vi } from 'vitest';

import { buildIssueSearchQuery, isRateLimitError, pollIssues } from '../../src/watcher/poll.js';
import type { GhRunner } from '../../src/core/gh.js';

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

describe('pollIssues with label source', () => {
  it('returns issues with trigger label', async () => {
    const gh = buildRunner(() => ({
      stdout: JSON.stringify([
        {
          number: 1,
          title: 'Ready issue',
          updatedAt: '2026-06-02T10:00:00Z',
          labels: [{ name: 'state:triaged' }],
          assignees: [{ login: 'robert-gleis' }]
        },
        { number: 2, title: 'Bug issue', updatedAt: '2026-06-02T11:00:00Z', labels: [{ name: 'bug' }] }
      ])
    }));

    const result = await pollIssues({
      repo,
      source: 'label',
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'state:triaged',
      gh
    });

    expect(result.rateLimited).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.issues).toEqual([
      {
        number: 1,
        title: 'Ready issue',
        updatedAt: '2026-06-02T10:00:00Z',
        labels: ['state:triaged'],
        assignees: ['robert-gleis']
      }
    ]);
  });

  it('sets rateLimited on gh failure', async () => {
    const gh = buildRunner(() => ({ exitCode: 1, stderr: 'HTTP 429: rate limit' }));
    const result = await pollIssues({
      repo,
      source: 'label',
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
    const result = await pollIssues({
      repo,
      source: 'label',
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
    const result = await pollIssues({
      repo,
      source: 'label',
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

    await pollIssues({
      repo,
      source: 'label',
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

describe('pollIssues', () => {
  it('builds assigned-to-me gh args', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify([
          {
            number: 27,
            title: 'Docker Runner',
            updatedAt: '2026-06-08T12:05:18Z',
            labels: [{ name: 'enhancement' }],
            assignees: [{ login: 'robert-gleis' }]
          }
        ]),
        stderr: '',
        exitCode: 0
      };
    };

    const result = await pollIssues({
      repo,
      source: 'assigned-to-me',
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'triaged',
      gh
    });

    expect(calls[0]).toContain('--assignee');
    expect(calls[0]).toContain('@me');
    expect(calls[0]).not.toContain('--search');
    expect(result.issues).toEqual([
      {
        number: 27,
        title: 'Docker Runner',
        updatedAt: '2026-06-08T12:05:18Z',
        labels: ['enhancement'],
        assignees: ['robert-gleis']
      }
    ]);
  });

  it('uses label source query for label polling', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return { stdout: '[]', stderr: '', exitCode: 0 };
    };

    await pollIssues({
      repo,
      source: 'label',
      since: '2026-06-01T00:00:00Z',
      triggerLabel: 'triaged',
      gh
    });

    expect(calls[0]).toContain('--search');
    expect(calls[0]).toContain('updated:>2026-06-01T00:00:00Z label:triaged');
  });
});
