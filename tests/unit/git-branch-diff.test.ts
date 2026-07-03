import { describe, expect, it } from 'vitest';

import { getBranchDiff } from '../../src/core/git.js';

describe('getBranchDiff', () => {
  it('diffs HEAD against the merge-base with the base branch', async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const run = async (args: string[], cwd: string): Promise<string> => {
      calls.push({ args, cwd });
      if (args[0] === 'merge-base') return 'abc123\n';
      if (args[0] === 'diff') return 'diff --git a/x b/x\n+added\n';
      throw new Error(`unexpected git args: ${args.join(' ')}`);
    };

    const diff = await getBranchDiff({ cwd: '/repo', base: 'main', run });

    expect(diff).toBe('diff --git a/x b/x\n+added\n');
    expect(calls[0]).toEqual({ args: ['merge-base', 'main', 'HEAD'], cwd: '/repo' });
    expect(calls[1]).toEqual({ args: ['diff', 'abc123..HEAD'], cwd: '/repo' });
  });

  it('defaults the base branch to main', async () => {
    const seen: string[][] = [];
    const run = async (args: string[]): Promise<string> => {
      seen.push(args);
      if (args[0] === 'merge-base') return 'base-sha';
      return '';
    };

    await getBranchDiff({ cwd: '/repo', run });

    expect(seen[0]).toEqual(['merge-base', 'main', 'HEAD']);
  });

  it('returns an empty string when there is no diff', async () => {
    const run = async (args: string[]): Promise<string> => {
      if (args[0] === 'merge-base') return 'sha';
      return '';
    };

    expect(await getBranchDiff({ cwd: '/repo', run })).toBe('');
  });
});
