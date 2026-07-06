import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { IssueIdError, resolveIssueNumber, type ResolveIssueNumberDeps } from '../../src/core/issue-id.js';

const tempDirs: string[] = [];
const originalCwd = process.cwd();

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-issue-id-'));
  tempDirs.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  process.chdir(originalCwd);
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makeDeps(overrides: Partial<ResolveIssueNumberDeps> = {}): ResolveIssueNumberDeps {
  return {
    readSessionFile: async () => null,
    readCurrentBranch: async () => null,
    ...overrides
  };
}

describe('resolveIssueNumber', () => {
  it('returns the override when provided', async () => {
    const result = await resolveIssueNumber('/repo', 7, makeDeps());

    expect(result).toBe(7);
  });

  it('reads the session file when override is missing', async () => {
    const result = await resolveIssueNumber('/repo', undefined, makeDeps({
      readSessionFile: async () => ({ issueNumber: 20 })
    }));

    expect(result).toBe(20);
  });

  it('parses the issue number from the current branch as a last resort', async () => {
    const result = await resolveIssueNumber('/repo', undefined, makeDeps({
      readSessionFile: async () => null,
      readCurrentBranch: async () => 'issue/42-something'
    }));

    expect(result).toBe(42);
  });

  it('throws IssueIdError when no source resolves', async () => {
    await expect(resolveIssueNumber('/repo', undefined, makeDeps())).rejects.toBeInstanceOf(IssueIdError);
  });

  it('ignores non-matching branch names', async () => {
    await expect(
      resolveIssueNumber('/repo', undefined, makeDeps({
        readCurrentBranch: async () => 'main'
      }))
    ).rejects.toBeInstanceOf(IssueIdError);
  });

  it('rejects branch names without a slug separator', async () => {
    await expect(
      resolveIssueNumber('/repo', undefined, makeDeps({
        readCurrentBranch: async () => 'issue/20'
      }))
    ).rejects.toBeInstanceOf(IssueIdError);
  });

  it('rejects --issue 0', async () => {
    await expect(resolveIssueNumber('/repo', 0, makeDeps())).rejects.toBeInstanceOf(IssueIdError);
  });

  it('rejects negative or non-integer --issue values', async () => {
    await expect(resolveIssueNumber('/repo', -1, makeDeps())).rejects.toBeInstanceOf(IssueIdError);
    await expect(resolveIssueNumber('/repo', 1.5, makeDeps())).rejects.toBeInstanceOf(IssueIdError);
  });

  it('reads session.json from the worktree root regardless of process cwd', async () => {
    const worktreePath = await makeRepo();
    const freesoloDir = path.join(worktreePath, '.git', 'freesolo');
    await fs.mkdir(freesoloDir, { recursive: true });
    await fs.writeFile(
      path.join(freesoloDir, 'session.json'),
      JSON.stringify({ issueNumber: 7 })
    );

    const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-issue-id-other-'));
    tempDirs.push(otherDir);
    process.chdir(otherDir);

    const resolved = await resolveIssueNumber(worktreePath, undefined);

    expect(resolved).toBe(7);
  });
});
