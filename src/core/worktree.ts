import fs from 'node:fs/promises';
import path from 'node:path';
import type { WriteStream } from 'node:tty';

import { execa, type ExecaError } from 'execa';

import type { ExistingWorkspaceMatch, IssueSummary, WorktreeEntry } from './types.js';

export const WORKTREE_SETUP_SCRIPT = path.join('scripts', 'setup-new-worktree.sh');

type CommandRunner = (command: string, args: string[], options?: { cwd?: string }) => Promise<unknown> | unknown;
type StdoutCommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<{ stdout: string }> | { stdout: string };

export interface WorktreeSetupOptions {
  spinnerLabel?: string;
  stream?: NodeJS.WriteStream;
}

export class WorktreeSetupError extends Error {
  constructor(output: string) {
    super(`Worktree setup failed.\n\n${output}`);
    this.name = 'WorktreeSetupError';
  }
}

export class WorktrunkMissingError extends Error {
  constructor() {
    super('Worktrunk is required for issueflow start. Install wt from https://worktrunk.dev/worktrunk/ and try again.');
    this.name = 'WorktrunkMissingError';
  }
}

export class WorktrunkPathResolutionError extends Error {
  constructor(branchName: string) {
    super(`Could not resolve Worktrunk checkout for branch ${branchName}.`);
    this.name = 'WorktrunkPathResolutionError';
  }
}

const defaultCommandRunner: CommandRunner = (command, args, options) => execa(command, args, options);

const defaultStdoutRunner: StdoutCommandRunner = async (command, args, options) => {
  const { stdout } = await execa(command, args, options);
  return { stdout };
};

function formatCapturedOutput(error: ExecaError): string {
  const lines = [error.shortMessage ?? error.message];
  const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : '';
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : '';

  if (stdout) {
    lines.push('', 'stdout:', stdout);
  }

  if (stderr) {
    lines.push('', 'stderr:', stderr);
  }

  return lines.join('\n');
}

async function withSpinner<T>(label: string | undefined, stream: NodeJS.WriteStream | undefined, task: () => Promise<T>): Promise<T> {
  const ttyStream = stream as WriteStream | undefined;

  if (!label || !ttyStream?.isTTY) {
    return task();
  }

  const frames = ['-', '\\', '|', '/'];
  let frameIndex = 0;

  const render = (status: string) => {
    ttyStream.write(`\r${frames[frameIndex]} ${status}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  render(label);
  const interval = setInterval(() => render(label), 80);

  try {
    const result = await task();
    clearInterval(interval);
    ttyStream.write(`\rDone: ${label}\n`);
    return result;
  } catch (error) {
    clearInterval(interval);
    ttyStream.write(`\rFailed: ${label}\n`);
    throw error;
  }
}

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

function parseWorktreeEntries(stdout: string): WorktreeEntry[] {
  const chunks = stdout.trim().split('\n\n').filter(Boolean);

  return chunks.map((chunk) => {
    const lines = chunk.split('\n');
    const worktreePath = lines[0].replace(/^worktree /, '');
    const branchName = lines.find((line) => line.startsWith('branch '))?.replace(/^branch refs\/heads\//, '') ?? '';

    return { branchName, worktreePath };
  });
}

export async function listWorktreeEntries(repoRoot: string): Promise<WorktreeEntry[]> {
  const { stdout } = await execa('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  return parseWorktreeEntries(stdout);
}

function isMissingExecutableError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT');
}

export async function ensureWorktrunkAvailable(runner: CommandRunner = defaultCommandRunner): Promise<void> {
  try {
    await runner('wt', ['--version']);
  } catch (error) {
    if (isMissingExecutableError(error)) {
      throw new WorktrunkMissingError();
    }

    throw error;
  }
}

export async function switchNewIssueWorktree(
  repoRoot: string,
  branchName: string,
  runner: CommandRunner = defaultCommandRunner
): Promise<void> {
  await runner('wt', ['switch', '--create', branchName], { cwd: repoRoot });
}

export async function switchExistingIssueWorktree(
  repoRoot: string,
  branchName: string,
  runner: CommandRunner = defaultCommandRunner
): Promise<void> {
  await runner('wt', ['switch', branchName], { cwd: repoRoot });
}

export async function resolveBranchWorktreePath(
  repoRoot: string,
  branchName: string,
  runner: StdoutCommandRunner = defaultStdoutRunner
): Promise<string> {
  const { stdout } = await runner('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot });
  const match = parseWorktreeEntries(stdout).find((entry) => entry.branchName === branchName);

  if (!match?.worktreePath) {
    throw new WorktrunkPathResolutionError(branchName);
  }

  return match.worktreePath;
}

export async function runWorktreeSetup(sourceCheckout: string, worktreePath: string, options: WorktreeSetupOptions = {}): Promise<boolean> {
  const scriptPath = path.join(worktreePath, WORKTREE_SETUP_SCRIPT);

  try {
    await fs.access(scriptPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }

  await withSpinner(options.spinnerLabel, options.stream ?? process.stderr, async () => {
    try {
      await execa('bash', [scriptPath], {
        cwd: worktreePath,
        env: {
          MAIN_REPO_ROOT: sourceCheckout
        }
      });
    } catch (error) {
      if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
        throw new WorktreeSetupError(formatCapturedOutput(error as ExecaError));
      }

      throw error;
    }
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
