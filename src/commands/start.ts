import { confirm, select } from '@inquirer/prompts';
import { execa } from 'execa';

import { getAdapter } from '../adapters/index.js';
import type { LaunchPlan } from '../adapters/types.js';
import { listAssignedIssues } from '../core/github.js';
import { parseGitHubRemote, readOriginRemote, resolveRepoRoot } from '../core/git.js';
import { writeIssuePacket, writeSessionState } from '../core/session-state.js';
import type { HostTool, IssueSummary, RepoContext, WorktreeEntry } from '../core/types.js';
import {
  attachExistingBranchToWorktree,
  buildBranchName,
  buildSiblingWorktreePath,
  createIssueWorktree,
  ensureUniqueWorkspaceNames,
  findExistingWorkspaceMatch,
  listLocalBranches,
  listWorktreeEntries
} from '../core/worktree.js';
import { buildIssuePacket, buildWorkflowKernel } from '../workflow/kernel.js';

export interface StartOptions {
  tool: HostTool;
  printOnly?: boolean;
}

type EmptyResult = { mode: 'empty'; message: string };
type PrintOnlyResult = { mode: 'print-only'; launchPlan: LaunchPlan };
type LaunchResult = { mode: 'launch'; launchPlan: LaunchPlan };

export type StartPlanResult = EmptyResult | PrintOnlyResult | LaunchResult;

export interface StartPlanDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  readOriginRemote: (cwd: string) => Promise<string>;
  listAssignedIssues: (repo: RepoContext) => Promise<IssueSummary[]>;
  listLocalBranches: (repoRoot: string) => Promise<string[]>;
  listWorktreeEntries: (repoRoot: string) => Promise<WorktreeEntry[]>;
  createIssueWorktree: (repoRoot: string, worktreePath: string, branchName: string) => Promise<void>;
  attachExistingBranchToWorktree: (repoRoot: string, worktreePath: string, branchName: string) => Promise<void>;
  writeSessionState: typeof writeSessionState;
  writeIssuePacket: typeof writeIssuePacket;
  chooseIssue: (issues: IssueSummary[]) => Promise<IssueSummary>;
  confirmReuse: (message: string) => Promise<boolean>;
}

const defaultDeps: StartPlanDeps = {
  resolveRepoRoot,
  readOriginRemote,
  listAssignedIssues,
  listLocalBranches,
  listWorktreeEntries,
  createIssueWorktree,
  attachExistingBranchToWorktree,
  writeSessionState,
  writeIssuePacket,
  chooseIssue: async (issues) =>
    select({
      message: 'Choose the issue to start',
      choices: issues.map((issue) => ({
        name: `#${issue.number} ${issue.title}`,
        value: issue
      }))
    }),
  confirmReuse: async (message) =>
    confirm({
      message,
      default: true
    })
};

export async function createStartPlan(input: { cwd: string; tool: HostTool; printOnly: boolean }, deps: StartPlanDeps = defaultDeps): Promise<StartPlanResult> {
  const rootDir = await deps.resolveRepoRoot(input.cwd);
  const remoteUrl = await deps.readOriginRemote(rootDir);
  const parsedRepo = parseGitHubRemote(remoteUrl);

  if (!parsedRepo) {
    throw new Error('origin is not a supported GitHub remote');
  }

  const repo = { ...parsedRepo, rootDir };
  const issues = await deps.listAssignedIssues(repo);

  if (issues.length === 0) {
    return {
      mode: 'empty',
      message: 'No assigned open issues in this repository.'
    };
  }

  const issue = await deps.chooseIssue(issues);
  const branchNames = await deps.listLocalBranches(rootDir);
  const worktreeEntries = await deps.listWorktreeEntries(rootDir);
  const existingMatch = findExistingWorkspaceMatch(branchNames, worktreeEntries, issue.number);
  const uniqueNames = ensureUniqueWorkspaceNames(rootDir, issue, branchNames, worktreeEntries);

  let branchName = buildBranchName(issue);
  let worktreePath = buildSiblingWorktreePath(rootDir, issue);

  if (existingMatch?.worktreePath) {
    const reuse = await deps.confirmReuse(`Reuse existing worktree at ${existingMatch.worktreePath}?`);

    if (reuse) {
      branchName = existingMatch.branchName;
      worktreePath = existingMatch.worktreePath;
    } else {
      branchName = uniqueNames.branchName;
      worktreePath = uniqueNames.worktreePath;

      if (!input.printOnly) {
        await deps.createIssueWorktree(rootDir, worktreePath, branchName);
      }
    }
  } else if (existingMatch?.branchName) {
    const reuse = await deps.confirmReuse(`Reuse existing branch ${existingMatch.branchName} with a new worktree?`);

    if (reuse) {
      branchName = existingMatch.branchName;

      if (!input.printOnly) {
        await deps.attachExistingBranchToWorktree(rootDir, worktreePath, branchName);
      }
    } else {
      branchName = uniqueNames.branchName;
      worktreePath = uniqueNames.worktreePath;

      if (!input.printOnly) {
        await deps.createIssueWorktree(rootDir, worktreePath, branchName);
      }
    }
  } else if (!input.printOnly) {
    await deps.createIssueWorktree(rootDir, worktreePath, branchName);
  }

  const startupPrompt = buildWorkflowKernel({
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body,
    issueUrl: issue.url,
    branchName,
    worktreePath
  });

  if (!input.printOnly) {
    await deps.writeSessionState(worktreePath, {
      issueNumber: issue.number,
      issueSlug: issue.slug,
      branchName,
      worktreePath,
      chosenHost: input.tool,
      currentStage: 'issue-intake',
      artifacts: {
        spec: null,
        plan: null,
        planReview: null,
        implementationReview: null
      }
    });

    await deps.writeIssuePacket(
      worktreePath,
      buildIssuePacket({
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueBody: issue.body,
        issueUrl: issue.url,
        branchName,
        worktreePath
      })
    );
  }

  const launchPlan = getAdapter(input.tool)({
    worktreePath,
    startupPrompt
  });

  if (input.printOnly) {
    return {
      mode: 'print-only',
      launchPlan
    };
  }

  return {
    mode: 'launch',
    launchPlan
  };
}

export async function startAction(options: StartOptions): Promise<void> {
  const result = await createStartPlan({
    cwd: process.cwd(),
    tool: options.tool,
    printOnly: Boolean(options.printOnly)
  });

  if (result.mode === 'empty') {
    console.log(result.message);
    return;
  }

  if (result.mode === 'print-only') {
    console.log(`${result.launchPlan.binary} ${result.launchPlan.args.join(' ')}`);
    if (result.launchPlan.postLaunchNote) {
      console.log(result.launchPlan.postLaunchNote);
    }
    return;
  }

  await execa(result.launchPlan.binary, result.launchPlan.args, {
    cwd: result.launchPlan.cwd,
    stdio: 'inherit'
  });
}
