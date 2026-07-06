import fs from 'node:fs/promises';
import path from 'node:path';

import { Command, InvalidArgumentError } from 'commander';
import { execa } from 'execa';

import { resolveRepoRoot } from '../core/git.js';
import { getIssueflowPath } from '../core/session-state.js';
import {
  createCandidateBranch,
  defaultRunGit,
  readCandidateBranchRecord,
  type CandidateBranchOutcome,
  type CandidateBranchSource,
  CandidateBranchError
} from '../integration/index.js';
import { defaultSetExitCode, defaultWrite, type WriteChannel } from './shared.js';

export interface CandidateCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveIssueSlug: (worktreePath: string, issueNumber: number) => Promise<string>;
  createCandidateBranch: typeof createCandidateBranch;
  readCandidateBranchRecord: typeof readCandidateBranchRecord;
  runGit: typeof defaultRunGit;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const branchSlugPattern = /^issue\/(\d+)-(.+)$/;

const defaultDeps: CandidateCommandDeps = {
  resolveRepoRoot,
  resolveIssueSlug,
  createCandidateBranch,
  readCandidateBranchRecord,
  runGit: defaultRunGit,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

export async function resolveIssueSlug(worktreePath: string, issueNumber: number): Promise<string> {
  try {
    const packetPath = await getIssueflowPath(worktreePath, 'current-issue.md');
    const resolvedPacketPath = path.isAbsolute(packetPath) ? packetPath : path.join(worktreePath, packetPath);
    const markdown = await fs.readFile(resolvedPacketPath, 'utf8');
    const branchMatch = markdown.match(/^## Branch\n(.+)$/m);
    if (branchMatch) {
      const branchSlug = branchSlugPattern.exec(branchMatch[1].trim());
      if (branchSlug && Number(branchSlug[1]) === issueNumber) {
        return branchSlug[2];
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    const sessionPath = await getIssueflowPath(worktreePath, 'session.json');
    const resolvedSessionPath = path.isAbsolute(sessionPath) ? sessionPath : path.join(worktreePath, sessionPath);
    const session = JSON.parse(await fs.readFile(resolvedSessionPath, 'utf8')) as { issueSlug?: string };
    if (session.issueSlug) {
      return session.issueSlug;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  try {
    const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath });
    const branchSlug = branchSlugPattern.exec(stdout.trim());
    if (branchSlug && Number(branchSlug[1]) === issueNumber) {
      return branchSlug[2];
    }
  } catch {
    // fall through
  }

  throw new CandidateBranchError(
    'slug-not-found',
    `Could not resolve issue slug for issue #${issueNumber}.`
  );
}

function parseBranches(branches: string, teamId: string): CandidateBranchSource[] {
  const names = branches
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  if (names.length === 0) {
    throw new CandidateBranchError('no-sources', 'At least one branch is required via --branches.');
  }

  return names.map((branchName) => ({
    branchName,
    ownerKind: 'team',
    ownerId: teamId
  }));
}

function printOutcome(outcome: CandidateBranchOutcome, deps: CandidateCommandDeps): void {
  if (outcome.status === 'conflict') {
    deps.write('stderr', `${JSON.stringify(outcome, null, 2)}\n`);
    deps.setExitCode(1);
    return;
  }

  deps.write('stdout', `${JSON.stringify(outcome, null, 2)}\n`);
  deps.setExitCode(0);
}

export async function createAction(
  options: { issue: number; team: string; branches: string; base?: string; force?: boolean },
  deps: CandidateCommandDeps = defaultDeps
): Promise<void> {
  try {
    const repoRoot = await deps.resolveRepoRoot(process.cwd());
    const issueSlug = await deps.resolveIssueSlug(repoRoot, options.issue);
    const sources = parseBranches(options.branches, options.team);

    const outcome = await deps.createCandidateBranch(
      {
        repoRoot,
        issueNumber: options.issue,
        issueSlug,
        teamId: options.team,
        sources,
        baseBranch: options.base,
        force: options.force
      },
      { runGit: deps.runGit }
    );

    printOutcome(outcome, deps);
  } catch (error) {
    if (error instanceof CandidateBranchError) {
      deps.write('stderr', `${error.message}\n`);
      if (error.code === 'git-error') {
        deps.setExitCode(3);
        return;
      }
      deps.setExitCode(2);
      return;
    }

    throw error;
  }
}

export async function showAction(
  options: { issue: number },
  deps: CandidateCommandDeps = defaultDeps
): Promise<void> {
  const repoRoot = await deps.resolveRepoRoot(process.cwd());
  const record = await deps.readCandidateBranchRecord(repoRoot);

  if (!record || record.issueNumber !== options.issue) {
    deps.write('stderr', `No candidate branch record for issue #${options.issue}.\n`);
    deps.setExitCode(2);
    return;
  }

  deps.write('stdout', `${JSON.stringify(record, null, 2)}\n`);
  deps.setExitCode(0);
}

export function registerCandidateCommands(program: Command, deps: CandidateCommandDeps = defaultDeps): void {
  const candidate = program.command('candidate').description('Create and inspect candidate integration branches');

  candidate
    .command('create')
    .description('Merge team worktree branches into a candidate branch')
    .requiredOption('--issue <number>', 'Issue number', (value) => {
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`--issue must be a positive integer (got "${value}").`);
      }
      return Number.parseInt(value, 10);
    })
    .requiredOption('--team <teamId>', 'Team identifier for provenance')
    .requiredOption('--branches <list>', 'Comma-separated source branch names')
    .option('--base <branch>', 'Base branch to create candidate from', 'main')
    .option('--force', 'Replace an existing successful candidate branch')
    .action((options) => createAction(options, deps));

  candidate
    .command('show')
    .description('Show candidate branch provenance for an issue')
    .requiredOption('--issue <number>', 'Issue number', (value) => {
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`--issue must be a positive integer (got "${value}").`);
      }
      return Number.parseInt(value, 10);
    })
    .action((options) => showAction(options, deps));
}
