import { describe, expect, it, vi } from 'vitest';

import { getCandidateBranchDiff, resolveIssueBodyFromRepo } from '../../src/verification/context-deps.js';

vi.mock('../../src/core/git.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/git.js')>();
  return { ...actual, getBranchDiff: vi.fn(async () => 'the diff') };
});

describe('getCandidateBranchDiff', () => {
  it('diffs against the provided base branch', async () => {
    const { getBranchDiff } = await import('../../src/core/git.js');
    await getCandidateBranchDiff('/repo', 'develop');
    expect(getBranchDiff).toHaveBeenLastCalledWith({ cwd: '/repo', base: 'develop' });
  });

  it("falls back to 'main' when the base branch is null", async () => {
    const { getBranchDiff } = await import('../../src/core/git.js');
    await getCandidateBranchDiff('/repo', null);
    expect(getBranchDiff).toHaveBeenLastCalledWith({ cwd: '/repo', base: 'main' });
  });

  it("falls back to 'main' when the base branch is omitted", async () => {
    const { getBranchDiff } = await import('../../src/core/git.js');
    await getCandidateBranchDiff('/repo');
    expect(getBranchDiff).toHaveBeenLastCalledWith({ cwd: '/repo', base: 'main' });
  });
});

describe('resolveIssueBodyFromRepo', () => {
  it('resolves the repo ref from origin and returns the issue body', async () => {
    const seen: { remoteCwd?: string; repo?: string; issue?: number } = {};

    const body = await resolveIssueBodyFromRepo('/repo', 42, {
      readOriginRemote: async (cwd) => {
        seen.remoteCwd = cwd;
        return 'git@github.com:acme/widgets.git';
      },
      getIssueBody: async (repo, issueNumber) => {
        seen.repo = `${repo.owner}/${repo.repo}`;
        seen.issue = issueNumber;
        return 'the body';
      }
    });

    expect(body).toBe('the body');
    expect(seen.remoteCwd).toBe('/repo');
    expect(seen.repo).toBe('acme/widgets');
    expect(seen.issue).toBe(42);
  });

  it('degrades to null when the remote is unparseable', async () => {
    const body = await resolveIssueBodyFromRepo('/repo', 1, {
      readOriginRemote: async () => 'not-a-github-remote',
      getIssueBody: async () => 'should not be called'
    });

    expect(body).toBeNull();
  });

  it('degrades to null when reading the origin remote throws', async () => {
    const body = await resolveIssueBodyFromRepo('/repo', 1, {
      readOriginRemote: async () => {
        throw new Error('no origin');
      },
      getIssueBody: async () => 'should not be called'
    });

    expect(body).toBeNull();
  });

  it('passes through a null body from getIssueBody (unreadable issue)', async () => {
    const body = await resolveIssueBodyFromRepo('/repo', 1, {
      readOriginRemote: async () => 'git@github.com:acme/widgets.git',
      getIssueBody: async () => null
    });

    expect(body).toBeNull();
  });
});
