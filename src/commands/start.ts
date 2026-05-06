import path from 'node:path';

import { confirm, select } from '@inquirer/prompts';
import { execa } from 'execa';

import { getAdapter } from '../adapters/index.js';
import type { LaunchPlan } from '../adapters/types.js';
import { findIssueArtifacts } from '../core/artifacts.js';
import { listAssignedIssues } from '../core/github.js';
import { parseGitHubRemote, readOriginRemote, resolveRepoRoot } from '../core/git.js';
import { writeIssuePacket, writeSessionState } from '../core/session-state.js';
import type { HostTool, IssueArtifactPaths, IssueSummary, RepoContext, WorktreeEntry } from '../core/types.js';
import {
  attachExistingBranchToWorktree,
  buildBranchName,
  buildSiblingWorktreePath,
  createIssueWorktree,
  ensureUniqueWorkspaceNames,
  findExistingWorkspaceMatch,
  ISSUE_BRANCH_START_POINT,
  listLocalBranches,
  listWorktreeEntries,
  runWorktreeSetup,
  WORKTREE_SETUP_SCRIPT
} from '../core/worktree.js';
import { buildIssuePacket, buildWorkflowKernel } from '../workflow/kernel.js';

export interface StartOptions {
  tool: HostTool;
  printOnly?: boolean;
}

type EmptyResult = { mode: 'empty'; message: string };
type CancelledResult = { mode: 'cancelled'; message: string };
type WorkspaceAction = 'create-worktree' | 'attach-branch-worktree' | 'reuse-worktree';
type WorkspacePlan = { action: WorkspaceAction; setupCommands: string[] };
type PrintOnlyResult = {
  mode: 'print-only';
  launchPlan: LaunchPlan;
  workspacePlan: WorkspacePlan;
  summaryLines: string[];
};
type LaunchResult = { mode: 'launch'; launchPlan: LaunchPlan };

export type StartPlanResult = EmptyResult | CancelledResult | PrintOnlyResult | LaunchResult;

export interface StartPlanDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  readOriginRemote: (cwd: string) => Promise<string>;
  listAssignedIssues: (repo: RepoContext) => Promise<IssueSummary[]>;
  listLocalBranches: (repoRoot: string) => Promise<string[]>;
  listWorktreeEntries: (repoRoot: string) => Promise<WorktreeEntry[]>;
  createIssueWorktree: (repoRoot: string, worktreePath: string, branchName: string) => Promise<void>;
  attachExistingBranchToWorktree: (repoRoot: string, worktreePath: string, branchName: string) => Promise<void>;
  setupNewWorktree?: (sourceCheckout: string, worktreePath: string) => Promise<boolean>;
  findIssueArtifacts: (repoRoot: string, issueNumber: number) => Promise<IssueArtifactPaths>;
  writeSessionState: typeof writeSessionState;
  writeIssuePacket: typeof writeIssuePacket;
  chooseIssue: (issues: IssueSummary[]) => Promise<IssueSummary>;
  confirmReuse: (message: string) => Promise<boolean>;
  now: () => Date;
}

const defaultDeps: StartPlanDeps = {
  resolveRepoRoot,
  readOriginRemote,
  listAssignedIssues,
  listLocalBranches,
  listWorktreeEntries,
  createIssueWorktree,
  attachExistingBranchToWorktree,
  setupNewWorktree: runWorktreeSetup,
  findIssueArtifacts,
  writeSessionState,
  writeIssuePacket,
  chooseIssue: async (issues) =>
    select({
      message: 'Choose the issue to start',
      choices: issues.map((issue) => ({
        name: buildIssueChoiceLabel(issue),
        value: issue
      }))
    }),
  confirmReuse: async (message) =>
    confirm({
      message,
      default: true
    }),
  now: () => new Date()
};

export function buildIssueChoiceLabel(issue: IssueSummary): string {
  return `[${issue.status ?? 'No Status'}] #${issue.number} ${issue.title}`;
}

function shellQuote(value: string): string {
  return /[^A-Za-z0-9_./:@=-]/.test(value) ? JSON.stringify(value) : value;
}

function renderCommand(parts: string[]): string {
  return parts.map(shellQuote).join(' ');
}

function renderEnvAssignment(name: string, value: string): string {
  return `${name}=${shellQuote(value)}`;
}

function summarizeLaunchCommand(launchPlan: LaunchPlan): string {
  return [launchPlan.binary, ...launchPlan.args.map((arg) => (arg.includes('\n') || arg.length > 120 ? '<workflow-kernel>' : shellQuote(arg)))].join(' ');
}

function buildPrintOnlySummary(input: {
  sourceCheckout: string;
  repoRoot: string;
  issue: IssueSummary;
  branchName: string;
  worktreePath: string;
  workspacePlan: WorkspacePlan;
  launchPlan: LaunchPlan;
}): string[] {
  const summaryLines = [
    `Source checkout: ${input.sourceCheckout}`,
    `Repo: ${input.repoRoot}`,
    `Issue: #${input.issue.number} ${input.issue.title}`,
    `Branch: ${input.branchName}`,
    `Worktree: ${input.worktreePath}`,
    `Workspace action: ${input.workspacePlan.action}`
  ];

  if (input.workspacePlan.setupCommands.length > 0) {
    summaryLines.push('Setup commands:');
    summaryLines.push(...input.workspacePlan.setupCommands);
  } else {
    summaryLines.push('Setup commands: reuse existing worktree');
  }

  summaryLines.push(`Launch command: ${summarizeLaunchCommand(input.launchPlan)}`);

  if (input.launchPlan.postLaunchNote) {
    summaryLines.push(`Note: ${input.launchPlan.postLaunchNote}`);
  }

  return summaryLines;
}

function buildCreateWorktreePlan(repoRoot: string, worktreePath: string, branchName: string): WorkspacePlan {
  return {
    action: 'create-worktree',
    setupCommands: [
      renderCommand(['git', '-C', repoRoot, 'worktree', 'add', '-b', branchName, worktreePath, ISSUE_BRANCH_START_POINT]),
      renderWorktreeSetupCommand(repoRoot, worktreePath)
    ]
  };
}

function buildAttachBranchPlan(repoRoot: string, worktreePath: string, branchName: string): WorkspacePlan {
  return {
    action: 'attach-branch-worktree',
    setupCommands: [
      renderCommand(['git', '-C', repoRoot, 'worktree', 'add', worktreePath, branchName]),
      renderWorktreeSetupCommand(repoRoot, worktreePath)
    ]
  };
}

function renderWorktreeSetupCommand(sourceCheckout: string, worktreePath: string): string {
  const setupScriptPath = path.join(worktreePath, WORKTREE_SETUP_SCRIPT);
  const setupInvocation = `${renderEnvAssignment('MAIN_REPO_ROOT', sourceCheckout)} ${renderCommand(['bash', WORKTREE_SETUP_SCRIPT])}`;

  return `if [ -f ${shellQuote(setupScriptPath)} ]; then ${renderCommand(['cd', worktreePath])} && ${setupInvocation}; fi`;
}

function toCancelledResult(error: unknown): CancelledResult | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (error.name !== 'ExitPromptError' && error.message !== 'User force closed the prompt with SIGINT') {
    return null;
  }

  return {
    mode: 'cancelled',
    message: 'Cancelled.'
  };
}

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

  let issue: IssueSummary;

  try {
    issue = await deps.chooseIssue(issues);
  } catch (error) {
    const cancelled = toCancelledResult(error);

    if (cancelled) {
      return cancelled;
    }

    throw error;
  }

  const branchNames = await deps.listLocalBranches(rootDir);
  const worktreeEntries = await deps.listWorktreeEntries(rootDir);
  const existingMatch = findExistingWorkspaceMatch(branchNames, worktreeEntries, issue.number);
  const uniqueNames = ensureUniqueWorkspaceNames(rootDir, issue, branchNames, worktreeEntries);

  let branchName = buildBranchName(issue);
  let worktreePath = buildSiblingWorktreePath(rootDir, issue);
  let workspacePlan = buildCreateWorktreePlan(rootDir, worktreePath, branchName);
  let shouldRunSetup = false;

  if (existingMatch?.worktreePath) {
    let reuse: boolean;

    try {
      reuse = await deps.confirmReuse(`Reuse existing worktree at ${existingMatch.worktreePath}?`);
    } catch (error) {
      const cancelled = toCancelledResult(error);

      if (cancelled) {
        return cancelled;
      }

      throw error;
    }

    if (reuse) {
      branchName = existingMatch.branchName;
      worktreePath = existingMatch.worktreePath;
      workspacePlan = {
        action: 'reuse-worktree',
        setupCommands: []
      };
    } else {
      branchName = uniqueNames.branchName;
      worktreePath = uniqueNames.worktreePath;
      workspacePlan = buildCreateWorktreePlan(rootDir, worktreePath, branchName);

      if (!input.printOnly) {
        await deps.createIssueWorktree(rootDir, worktreePath, branchName);
        shouldRunSetup = true;
      }
    }
  } else if (existingMatch?.branchName) {
    let reuse: boolean;

    try {
      reuse = await deps.confirmReuse(`Reuse existing branch ${existingMatch.branchName} with a new worktree?`);
    } catch (error) {
      const cancelled = toCancelledResult(error);

      if (cancelled) {
        return cancelled;
      }

      throw error;
    }

    if (reuse) {
      branchName = existingMatch.branchName;
      workspacePlan = buildAttachBranchPlan(rootDir, worktreePath, branchName);

      if (!input.printOnly) {
        await deps.attachExistingBranchToWorktree(rootDir, worktreePath, branchName);
        shouldRunSetup = true;
      }
    } else {
      branchName = uniqueNames.branchName;
      worktreePath = uniqueNames.worktreePath;
      workspacePlan = buildCreateWorktreePlan(rootDir, worktreePath, branchName);

      if (!input.printOnly) {
        await deps.createIssueWorktree(rootDir, worktreePath, branchName);
        shouldRunSetup = true;
      }
    }
  } else if (!input.printOnly) {
    await deps.createIssueWorktree(rootDir, worktreePath, branchName);
    shouldRunSetup = true;
  }

  if (shouldRunSetup) {
    await deps.setupNewWorktree?.(rootDir, worktreePath);
  }

  const repoRoot = worktreePath;
  const artifacts = await deps.findIssueArtifacts(repoRoot, issue.number);

  const workflowInput = {
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body,
    issueUrl: issue.url,
    labels: issue.labels,
    assignees: issue.assignees,
    repoRoot,
    branchName,
    worktreePath,
    artifacts
  };
  const startupPrompt = buildWorkflowKernel(workflowInput);

  if (!input.printOnly) {
    const timestamp = deps.now().toISOString();

    await deps.writeSessionState(worktreePath, {
      issueNumber: issue.number,
      issueSlug: issue.slug,
      repoRoot,
      branchName,
      worktreePath,
      chosenHost: input.tool,
      currentStage: 'issue-intake',
      reviewGates: {
        plan: 'pending',
        implementation: 'pending'
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      artifacts
    });

    await deps.writeIssuePacket(worktreePath, buildIssuePacket(workflowInput));
  }

  const launchPlan = getAdapter(input.tool)({
    worktreePath,
    startupPrompt
  });

  if (input.printOnly) {
    return {
      mode: 'print-only',
      launchPlan,
      workspacePlan,
      summaryLines: buildPrintOnlySummary({
        sourceCheckout: rootDir,
        repoRoot,
        issue,
        branchName,
        worktreePath,
        workspacePlan,
        launchPlan
      })
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

  if (result.mode === 'empty' || result.mode === 'cancelled') {
    console.log(result.message);
    return;
  }

  if (result.mode === 'print-only') {
    for (const line of result.summaryLines) {
      console.log(line);
    }
    return;
  }

  await execa(result.launchPlan.binary, result.launchPlan.args, {
    cwd: result.launchPlan.cwd,
    stdio: 'inherit'
  });
}
