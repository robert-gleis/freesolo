import { describe, expect, it } from 'vitest';

import { getIssueBody } from '../../src/core/github.js';

const repo = { owner: 'acme', repo: 'widget' };

describe('getIssueBody', () => {
  it('reads a single issue body via gh issue view --json body', async () => {
    const calls: string[][] = [];
    const run = async (args: string[]): Promise<string> => {
      calls.push(args);
      return JSON.stringify({ body: 'The full issue body.' });
    };

    const body = await getIssueBody(repo, 42, { run });

    expect(body).toBe('The full issue body.');
    expect(calls[0]).toEqual([
      'issue',
      'view',
      '42',
      '--repo',
      'acme/widget',
      '--json',
      'body'
    ]);
  });

  it('returns an empty string when the issue has no body', async () => {
    const run = async (): Promise<string> => JSON.stringify({ body: null });

    expect(await getIssueBody(repo, 1, { run })).toBe('');
  });

  it('returns null when the issue cannot be read (missing / gh error)', async () => {
    const run = async (): Promise<string> => {
      throw new Error('gh: issue not found');
    };

    expect(await getIssueBody(repo, 999, { run })).toBeNull();
  });

  it('returns null when gh returns unparseable output', async () => {
    const run = async (): Promise<string> => 'not json';

    expect(await getIssueBody(repo, 5, { run })).toBeNull();
  });
});
