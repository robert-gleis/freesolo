import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { ExistingWorkspaceMatch, IssueSummary, WorktreeEntry } from './types.js';

export const WORKTREE_SETUP_SCRIPT = path.join('scripts', 'setup-new-worktree.sh');
export const ISSUE_BRANCH_START_POINT = 'origin/main';

export function buildBranchName(issue: Pick<IssueSummary, 'number' | 'slug'>): string {
  return `issue/${issue.number}-${issue.slug}`;
}

export function buildSiblingWorktreePath(repoRoot: string, issue: Pick<IssueSummary, 'number' | 'slug'>): string {
  const repoName = path.basename(repoRoot);
  return path.join(path.dirname(repoRoot), `${repoName}-${issue.number}-${issue.slug}`);
}

export function ensureUniqueWorkspaceNames(
  repoRoot: string,
  issue: Pick<IssueSummary, 'number' | 'slug'>,
  branchNames: string[],
  worktrees: WorktreeEntry[]
): { branchName: string; worktreePath: string } {
  const baseBranchName = buildBranchName(issue);
  const baseWorktreePath = buildSiblingWorktreePath(repoRoot, issue);

  let index = 1;
  let candidateBranch = baseBranchName;
  let candidatePath = baseWorktreePath;

  while (branchNames.includes(candidateBranch) || worktrees.some((entry) => entry.worktreePath === candidatePath)) {
    index += 1;
    candidateBranch = `${baseBranchName}-${index}`;
    candidatePath = `${baseWorktreePath}-${index}`;
  }

  return { branchName: candidateBranch, worktreePath: candidatePath };
}

export async function listLocalBranches(repoRoot: string): Promise<string[]> {
  const { stdout } = await execa('git', ['branch', '--format=%(refname:short)'], { cwd: repoRoot });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function listWorktreeEntries(repoRoot: string): Promise<WorktreeEntry[]> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  const chunks = stdout.trim().split('\n\n').filter(Boolean);

  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const worktreePath = lines[0].replace(/^worktree /, '');
    const branchName = lines.find((line) => line.startsWith('branch '))?.replace(/^branch refs\/heads\//, '') ?? '';

    return { branchName, worktreePath };
  });
}

export async function createIssueWorktree(repoRoot: string, worktreePath: string, branchName: string): Promise<void> {
  await execa('git', ['worktree', 'add', '-b', branchName, worktreePath, ISSUE_BRANCH_START_POINT], { cwd: repoRoot });
}

export async function attachExistingBranchToWorktree(
  repoRoot: string,
  worktreePath: string,
  branchName: string
): Promise<void> {
  await execa('git', ['worktree', 'add', worktreePath, branchName], { cwd: repoRoot });
}

export async function runWorktreeSetup(sourceCheckout: string, worktreePath: string): Promise<boolean> {
  const scriptPath = path.join(worktreePath, WORKTREE_SETUP_SCRIPT);

  try {
    await fs.access(scriptPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }

  await execa('bash', [scriptPath], {
    cwd: worktreePath,
    env: {
      MAIN_REPO_ROOT: sourceCheckout
    },
    stdio: 'inherit'
  });

  return true;
}

export function findExistingWorkspaceMatch(
  branchNames: string[],
  worktrees: ExistingWorkspaceMatch[],
  issueNumber: number
): ExistingWorkspaceMatch | null {
  const prefix = `issue/${issueNumber}-`;
  const worktreeMatch = worktrees.find((entry) => entry.branchName.startsWith(prefix));
  if (worktreeMatch) {
    return worktreeMatch;
  }

  const branchMatch = branchNames.find((branchName) => branchName.startsWith(prefix));
  return branchMatch ? { branchName: branchMatch } : null;
}
