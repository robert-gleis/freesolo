import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Command, Option } from 'commander';
import { execa } from 'execa';

import type { AgentAdapter } from '../agents/index.js';
import type { AppendEventInput, EventLog } from '../event-log/types.js';
import { openEventLog } from '../event-log/index.js';
import { resolveRepoRef, resolveRepoRoot } from '../core/git.js';
import { IssueIdError, resolveIssueNumber } from '../core/issue-id.js';
import { getFreesoloPath } from '../core/session-state.js';
import {
  createDefaultPlannerAgent,
  readTeamPlan,
  runTeamPlanner,
  TeamPlanNotFoundError,
  TeamPlanValidationError,
  validateTeamPlanFile,
  writeTeamPlan,
  getTeamPlanPath,
  type PlannerIssue
} from '../planner/index.js';
import { maybeAutoApproveTeamPlan } from '../policy/autonomous-approval.js';
import { InvalidTransitionError, type WorkflowState } from '../workflow/state-machine.js';
import type { RepoRef } from '../core/types.js';
import {
  MalformedStateError,
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/local-state-store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface PlanCommandDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveRepoRef: (cwd: string) => Promise<RepoRef>;
  resolveIssueNumber: (worktreePath: string, override: number | undefined) => Promise<number>;
  readState: (repo: RepoRef, issue: number) => Promise<WorkflowState | null>;
  writeState: (
    repo: RepoRef,
    issue: number,
    from: WorkflowState,
    to: WorkflowState
  ) => Promise<void>;
  runTeamPlanner: typeof runTeamPlanner;
  createPlannerAgent: (issue: PlannerIssue) => AgentAdapter;
  fetchIssue: (repo: RepoRef, issueNumber: number, worktreePath: string) => Promise<PlannerIssue>;
  readTeamPlan: typeof readTeamPlan;
  writeTeamPlan: typeof writeTeamPlan;
  getTeamPlanPath: typeof getTeamPlanPath;
  openEditor: (filePath: string, env: NodeJS.ProcessEnv) => Promise<number>;
  maybeAutoApproveTeamPlan: typeof maybeAutoApproveTeamPlan;
  appendEvent: (input: AppendEventInput) => void;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

async function defaultFetchIssue(
  repo: RepoRef,
  issueNumber: number,
  worktreePath: string
): Promise<PlannerIssue> {
  try {
    const { stdout } = await execa(
      'gh',
      [
        'issue',
        'view',
        String(issueNumber),
        '--repo',
        `${repo.owner}/${repo.repo}`,
        '--json',
        'number,title,body'
      ],
      { cwd: worktreePath }
    );
    const parsed = JSON.parse(stdout) as { number: number; title: string; body?: string };
    return {
      number: parsed.number,
      title: parsed.title,
      body: parsed.body ?? ''
    };
  } catch {
    const packetPath = await getFreesoloPath(worktreePath, 'current-issue.md');
    const markdown = await fs.readFile(packetPath, 'utf8');
    return parseIssuePacket(markdown, issueNumber);
  }
}

function parseIssuePacket(markdown: string, issueNumber: number): PlannerIssue {
  const titleMatch = markdown.match(/^# Issue #\d+: (.+)$/m);
  const bodyMatch = markdown.match(/^## Body\n([\s\S]*)$/m);
  return {
    number: issueNumber,
    title: titleMatch?.[1]?.trim() ?? `Issue #${issueNumber}`,
    body: bodyMatch?.[1]?.trim() ?? ''
  };
}

async function defaultOpenEditor(filePath: string, env: NodeJS.ProcessEnv): Promise<number> {
  const editor = env.EDITOR?.trim() || 'vi';
  const parts = editor.split(/\s+/);
  const command = parts[0];
  const args = [...parts.slice(1), filePath];
  const result = await execa(command, args, {
    env,
    stdio: 'inherit',
    reject: false
  });
  return result.exitCode ?? 1;
}

let defaultEventLog: EventLog | undefined;

function getDefaultEventLog(): EventLog {
  if (!defaultEventLog) {
    defaultEventLog = openEventLog();
  }
  return defaultEventLog;
}

const defaultDeps: PlanCommandDeps = {
  resolveRepoRoot,
  resolveRepoRef,
  resolveIssueNumber: (worktreePath, override) => resolveIssueNumber(worktreePath, override),
  readState: defaultReadState,
  writeState: defaultWriteState,
  runTeamPlanner,
  createPlannerAgent: createDefaultPlannerAgent,
  fetchIssue: defaultFetchIssue,
  readTeamPlan,
  writeTeamPlan,
  getTeamPlanPath,
  openEditor: defaultOpenEditor,
  maybeAutoApproveTeamPlan,
  appendEvent: (input) => {
    getDefaultEventLog().append(input);
  },
  env: process.env,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

function requireEngineGate(subcommand: string, deps: PlanCommandDeps): boolean {
  if (deps.env.FREESOLO_ENGINE === '1') {
    return true;
  }
  deps.write(
    'stderr',
    `freesolo plan ${subcommand} is engine-only. Set FREESOLO_ENGINE=1 to authorise the call; agent processes must not bypass the workflow engine.\n`
  );
  deps.setExitCode(3);
  return false;
}

function withCommanderErrorHandling(
  deps: PlanCommandDeps,
  action: () => Promise<void>
): Promise<void> {
  return action().catch((error: unknown) => {
    if (error instanceof Error && error.name === 'CommanderError') {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);

    if (error instanceof IssueIdError) {
      deps.setExitCode(2);
      return;
    }

    if (error instanceof MalformedStateError) {
      deps.setExitCode(4);
      return;
    }

    deps.setExitCode(1);
  });
}

async function resolveIssueContext(
  deps: PlanCommandDeps,
  issueOverride: number | undefined
): Promise<{ issueNumber: number; repo: RepoRef; worktreePath: string }> {
  const worktreePath = await deps.resolveRepoRoot(process.cwd());
  const issueNumber = await deps.resolveIssueNumber(worktreePath, issueOverride);
  const repo = await deps.resolveRepoRef(process.cwd());
  return { issueNumber, repo, worktreePath };
}

export function registerPlanCommands(program: Command, deps: PlanCommandDeps = defaultDeps): Command {
  const plan = program.command('plan').description('Generate, inspect, edit, and approve team plans');

  plan
    .command('generate')
    .description('Run the team planner and transition triaged → planned')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      if (!requireEngineGate('generate', deps)) {
        return;
      }

      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, repo, worktreePath } = await resolveIssueContext(deps, options.issue);
        const current = await deps.readState(repo, issueNumber);
        if (current === null) {
          deps.write(
            'stderr',
            `Issue #${issueNumber} has no current workflow state. Initialise it before generating a plan.\n`
          );
          deps.setExitCode(1);
          return;
        }
        if (current !== 'triaged') {
          deps.write(
            'stderr',
            `Issue #${issueNumber} must be in state "triaged" to generate a plan (current: "${current}").\n`
          );
          deps.setExitCode(1);
          return;
        }

        const issue = await deps.fetchIssue(repo, issueNumber, worktreePath);
        const agent = deps.createPlannerAgent(issue);
        const result = await deps.runTeamPlanner({ worktreePath, issue, agent });
        await deps.writeState(repo, issueNumber, 'triaged', 'planned');
        deps.write('stdout', `team plan written: ${result.teamPlanPath}\n`);
        const approval = await deps.maybeAutoApproveTeamPlan(
          {
            repoRoot: worktreePath,
            worktreePath,
            repo,
            issueNumber,
            teamPlanPath: result.teamPlanPath
          },
          {
            readTeamPlan: deps.readTeamPlan,
            writeState: deps.writeState,
            appendEvent: deps.appendEvent
          }
        );
        if (approval.status === 'approved') {
          deps.write('stdout', 'planned -> approved (autonomous)\n');
        }
      });
    });

  plan
    .command('show')
    .description('Print the team plan JSON for an issue')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      await withCommanderErrorHandling(deps, async () => {
        const { worktreePath } = await resolveIssueContext(deps, options.issue);
        const definition = await deps.readTeamPlan(worktreePath);
        deps.write('stdout', `${JSON.stringify(definition, null, 2)}\n`);
      });
    });

  plan
    .command('edit')
    .description('Edit the team plan in $EDITOR')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      await withCommanderErrorHandling(deps, async () => {
        const { worktreePath } = await resolveIssueContext(deps, options.issue);
        const teamPlanPath = await deps.getTeamPlanPath(worktreePath);
        let original: string;
        try {
          original = await fs.readFile(teamPlanPath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new TeamPlanNotFoundError(teamPlanPath);
          }
          throw error;
        }

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-plan-edit-'));
        const tempPath = path.join(tempDir, 'team-plan.json');
        await fs.writeFile(tempPath, original);

        const exitCode = await deps.openEditor(tempPath, deps.env);
        if (exitCode !== 0) {
          await fs.rm(tempDir, { recursive: true, force: true });
          deps.write('stderr', `Editor exited with code ${exitCode}.\n`);
          deps.setExitCode(1);
          return;
        }

        const edited = await fs.readFile(tempPath, 'utf8');
        await fs.rm(tempDir, { recursive: true, force: true });

        try {
          const definition = validateTeamPlanFile(edited);
          await deps.writeTeamPlan(worktreePath, definition);
          deps.write('stdout', 'team plan updated\n');
        } catch (error) {
          if (error instanceof TeamPlanValidationError) {
            deps.write('stderr', `${error.message}\n`);
            deps.setExitCode(1);
            return;
          }
          throw error;
        }
      });
    });

  plan
    .command('approve')
    .description('Validate the team plan and transition planned → approved')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      if (!requireEngineGate('approve', deps)) {
        return;
      }

      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, repo, worktreePath } = await resolveIssueContext(deps, options.issue);

        const current = await deps.readState(repo, issueNumber);
        if (current === null) {
          deps.write(
            'stderr',
            `Issue #${issueNumber} has no current workflow state. Initialise it before approving a plan.\n`
          );
          deps.setExitCode(1);
          return;
        }
        if (current !== 'planned') {
          deps.write(
            'stderr',
            `Issue #${issueNumber} must be in state "planned" to approve (current: "${current}").\n`
          );
          deps.setExitCode(1);
          return;
        }

        await deps.readTeamPlan(worktreePath);

        try {
          await deps.writeState(repo, issueNumber, 'planned', 'approved');
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            deps.write('stderr', `${error.message}\n`);
            deps.setExitCode(1);
            return;
          }
          throw error;
        }

        deps.write('stdout', 'planned -> approved\n');
      });
    });

  return plan;
}
