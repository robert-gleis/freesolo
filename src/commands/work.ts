import fs from 'node:fs/promises';
import path from 'node:path';

import { Command, Option } from 'commander';
import { execa } from 'execa';

import { resolveRepoRoot } from '../core/git.js';
import { getFreesoloPath } from '../core/session-state.js';
import { slugifyIssueTitle } from '../core/slug.js';
import type { HostTool } from '../core/types.js';
import {
  ensureUniqueWorkspaceNames,
  ensureWorktrunkAvailable,
  findExistingWorkspaceMatch,
  listLocalBranches,
  listWorktreeEntries,
  resolveBranchWorktreePath,
  runWorktreeSetup,
  switchExistingIssueWorktree,
  switchNewIssueWorktree
} from '../core/worktree.js';
import { createVerifyPlan, defaultVerifyPlanDeps } from './verify.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface WorkIssue {
  number: number;
  title: string;
  body: string;
}

export interface WorkVerifyResult {
  status: 'pass' | 'fail';
  attemptsUsed: number;
  maxAttempts: number;
  runDirectory: string;
}

export interface WorkCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  fetchIssue: (repoRoot: string, issueNumber: number) => Promise<WorkIssue>;
  ensureWorktree: (
    repoRoot: string,
    issue: WorkIssue
  ) => Promise<{ branchName: string; worktreePath: string; reused: boolean }>;
  defaultBranch: (repoRoot: string) => Promise<string>;
  /** Write a file under the worktree's freesolo state dir; returns the absolute path. */
  writeStateFile: (worktreePath: string, fileName: string, content: string) => Promise<string>;
  countCommits: (worktreePath: string, baseBranch: string) => Promise<number>;
  tmuxHasSession: (name: string) => Promise<boolean>;
  tmuxNewSession: (name: string, cwd: string, command: string) => Promise<void>;
  runVerify: (
    worktreePath: string,
    issueNumber: number,
    branchName: string,
    baseBranch: string
  ) => Promise<WorkVerifyResult>;
  createPullRequest: (
    worktreePath: string,
    issue: WorkIssue,
    branchName: string,
    baseBranch: string
  ) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

async function defaultFetchIssue(repoRoot: string, issueNumber: number): Promise<WorkIssue> {
  const { stdout } = await execa(
    'gh',
    ['issue', 'view', String(issueNumber), '--json', 'number,title,body'],
    { cwd: repoRoot }
  );
  const parsed = JSON.parse(stdout) as { number: number; title: string; body?: string };
  return { number: parsed.number, title: parsed.title, body: parsed.body ?? '' };
}

async function defaultEnsureWorktree(
  repoRoot: string,
  issue: WorkIssue
): Promise<{ branchName: string; worktreePath: string; reused: boolean }> {
  await ensureWorktrunkAvailable();

  const branchNames = await listLocalBranches(repoRoot);
  const worktrees = await listWorktreeEntries(repoRoot);
  const existing = findExistingWorkspaceMatch(branchNames, worktrees, issue.number);

  if (existing) {
    await switchExistingIssueWorktree(repoRoot, existing.branchName);
    const worktreePath = await resolveBranchWorktreePath(repoRoot, existing.branchName);
    return { branchName: existing.branchName, worktreePath, reused: true };
  }

  const slug = slugifyIssueTitle(issue.title);
  const { branchName } = ensureUniqueWorkspaceNames(
    repoRoot,
    { number: issue.number, slug },
    branchNames,
    worktrees
  );
  await switchNewIssueWorktree(repoRoot, branchName);
  const worktreePath = await resolveBranchWorktreePath(repoRoot, branchName);
  await runWorktreeSetup(repoRoot, worktreePath, { spinnerLabel: 'worktree setup' });
  return { branchName, worktreePath, reused: false };
}

async function defaultDefaultBranch(repoRoot: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: repoRoot
    });
    return stdout.trim().replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

async function defaultWriteStateFile(
  worktreePath: string,
  fileName: string,
  content: string
): Promise<string> {
  const relativeOrAbsolute = await getFreesoloPath(worktreePath, fileName);
  const absolute = path.isAbsolute(relativeOrAbsolute)
    ? relativeOrAbsolute
    : path.join(worktreePath, relativeOrAbsolute);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, 'utf8');
  return absolute;
}

async function defaultCountCommits(worktreePath: string, baseBranch: string): Promise<number> {
  const { stdout } = await execa('git', ['rev-list', '--count', `${baseBranch}..HEAD`], {
    cwd: worktreePath
  });
  return Number.parseInt(stdout.trim(), 10) || 0;
}

async function defaultTmuxHasSession(name: string): Promise<boolean> {
  const result = await execa('tmux', ['has-session', '-t', `=${name}`], { reject: false });
  return result.exitCode === 0;
}

async function defaultTmuxNewSession(name: string, cwd: string, command: string): Promise<void> {
  await execa('tmux', ['new-session', '-d', '-s', name, '-c', cwd, command]);
}

async function defaultRunVerify(
  worktreePath: string,
  issueNumber: number,
  branchName: string,
  baseBranch: string
): Promise<WorkVerifyResult> {
  const result = await createVerifyPlan(
    { cwd: worktreePath, options: { issue: issueNumber } },
    {
      ...defaultVerifyPlanDeps,
      resolveRepoRoot: async () => worktreePath,
      resolveCandidateBranch: async () => ({ branchName, baseBranch })
    }
  );

  if (result.mode === 'error') {
    throw new Error(result.message);
  }
  if (result.mode === 'print-only') {
    throw new Error('unexpected print-only verify result');
  }

  const firstLog = result.run.checks[0]?.logPath;
  return {
    status: result.run.status === 'pass' ? 'pass' : 'fail',
    attemptsUsed: result.run.attemptsUsed,
    maxAttempts: result.run.maxAttempts,
    runDirectory: firstLog ? path.dirname(firstLog) : ''
  };
}

async function defaultCreatePullRequest(
  worktreePath: string,
  issue: WorkIssue,
  branchName: string,
  baseBranch: string
): Promise<string> {
  await execa('git', ['push', '-u', 'origin', branchName], { cwd: worktreePath });
  const { stdout } = await execa(
    'gh',
    [
      'pr',
      'create',
      '--base',
      baseBranch,
      '--head',
      branchName,
      '--title',
      `Issue #${issue.number}: ${issue.title}`,
      '--body',
      `Closes #${issue.number}\n\n🤖 Created by \`freesolo work\` after a green gate route (review + lint + test).`
    ],
    { cwd: worktreePath }
  );
  return stdout.trim().split('\n').pop() ?? '';
}

const defaultDeps: WorkCommandDeps = {
  resolveRepoRoot,
  fetchIssue: defaultFetchIssue,
  ensureWorktree: defaultEnsureWorktree,
  defaultBranch: defaultDefaultBranch,
  writeStateFile: defaultWriteStateFile,
  countCommits: defaultCountCommits,
  tmuxHasSession: defaultTmuxHasSession,
  tmuxNewSession: defaultTmuxNewSession,
  runVerify: defaultRunVerify,
  createPullRequest: defaultCreatePullRequest,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

export function buildIssuePacketMarkdown(issue: WorkIssue, branchName: string): string {
  return `# Issue #${issue.number}: ${issue.title}\n\n## Branch\n${branchName}\n\n## Body\n${issue.body}\n`;
}

export function buildWorkerPrompt(issue: WorkIssue, branchName: string): string {
  return [
    `# Issue #${issue.number}: ${issue.title}`,
    '',
    issue.body,
    '',
    '---',
    '',
    `You are working autonomously in a dedicated git worktree on branch \`${branchName}\`.`,
    'Implement the issue above completely. Follow the existing code conventions of this repository.',
    'Commit all of your work with descriptive messages. Do not push. Exit when you are done.'
  ].join('\n');
}

// ponytail: host CLI flags hardcoded; move to freesolo.config.json when they start drifting.
export function buildWorkerCommand(tool: HostTool, promptPath: string): string {
  const prompt = `"$(cat '${promptPath}')"`;
  const commands: Record<HostTool, string> = {
    claude: `claude -p ${prompt} --permission-mode acceptEdits`,
    codex: `codex exec --full-auto ${prompt}`,
    cursor: `cursor-agent -p ${prompt} --force`
  };
  // Keep the pane readable for anyone attached when the worker finishes.
  return `${commands[tool]}; echo; echo '[freesolo] worker finished — session closes in 15s'; sleep 15`;
}

export async function workAction(
  issueArg: number,
  options: { tool: HostTool; poll: number },
  deps: WorkCommandDeps = defaultDeps
): Promise<void> {
  try {
    const repoRoot = await deps.resolveRepoRoot(process.cwd());
    const issue = await deps.fetchIssue(repoRoot, issueArg);
    const baseBranch = await deps.defaultBranch(repoRoot);

    const { branchName, worktreePath, reused } = await deps.ensureWorktree(repoRoot, issue);
    deps.write(
      'stdout',
      `${reused ? 'reusing' : 'created'} worktree ${worktreePath} (branch ${branchName})\n`
    );

    await deps.writeStateFile(
      worktreePath,
      'current-issue.md',
      buildIssuePacketMarkdown(issue, branchName)
    );
    const promptPath = await deps.writeStateFile(
      worktreePath,
      'worker-prompt.md',
      buildWorkerPrompt(issue, branchName)
    );

    const session = `freesolo-${issue.number}`;
    if (await deps.tmuxHasSession(session)) {
      deps.write(
        'stderr',
        `tmux session "${session}" is already running — attach with \`tmux attach -t ${session}\` or kill it first.\n`
      );
      deps.setExitCode(2);
      return;
    }

    await deps.tmuxNewSession(session, worktreePath, buildWorkerCommand(options.tool, promptPath));
    deps.write(
      'stdout',
      `worker (${options.tool}) started in tmux session "${session}" — watch live: tmux attach -t ${session}\n`
    );

    while (await deps.tmuxHasSession(session)) {
      await deps.sleep(options.poll * 1000);
    }
    deps.write('stdout', 'worker session finished\n');

    const commits = await deps.countCommits(worktreePath, baseBranch);
    if (commits === 0) {
      deps.write(
        'stderr',
        `worker left no commits on ${branchName} — manual input required.\nWorktree: ${worktreePath}\n`
      );
      deps.setExitCode(1);
      return;
    }
    deps.write('stdout', `worker committed ${commits} commit(s) — running gate route\n`);

    const verify = await deps.runVerify(worktreePath, issue.number, branchName, baseBranch);
    if (verify.status !== 'pass') {
      deps.write(
        'stderr',
        [
          `gate route still red after ${verify.attemptsUsed}/${verify.maxAttempts} attempts — the agents could not fix this alone, manual input required.`,
          `Artifacts: ${verify.runDirectory}`,
          `Worktree:  ${worktreePath}`,
          `Reports:   freesolo reports show --issue ${issue.number}`
        ].join('\n') + '\n'
      );
      deps.setExitCode(1);
      return;
    }
    deps.write(
      'stdout',
      `gate route green (attempt ${verify.attemptsUsed}/${verify.maxAttempts}) — creating PR\n`
    );

    const url = await deps.createPullRequest(worktreePath, issue, branchName, baseBranch);
    deps.write('stdout', `PR created: ${url}\n`);
  } catch (error) {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(1);
  }
}

export function registerWorkCommand(program: Command, deps: WorkCommandDeps = defaultDeps): Command {
  return program
    .command('work')
    .description(
      'Work one issue end-to-end: worktree + branch, autonomous worker in tmux, review/lint/test gate with fresh fixer agents, then a PR'
    )
    .argument('<issue>', 'GitHub issue number', parseIssueNumber)
    .addOption(
      new Option('--tool <tool>', 'Host tool for the worker agent')
        .choices(['codex', 'claude', 'cursor'])
        .makeOptionMandatory()
    )
    .addOption(
      new Option('--poll <seconds>', 'Poll interval while the worker session runs')
        .argParser(parseIssueNumber)
        .default(5)
    )
    .action(async (issue: number, options: { tool: HostTool; poll: number }) => {
      await workAction(issue, options, deps);
    });
}
