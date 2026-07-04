import { Command, Option } from 'commander';

import { resolveRepoRef, resolveRepoRoot } from '../core/git.js';
import { IssueIdError, resolveIssueNumber } from '../core/issue-id.js';
import type { AppendEventInput } from '../event-log/types.js';
import { ScriptedAgentAdapter } from '../agents/scripted.js';
import { openEventLog } from '../event-log/index.js';
import type { EventLog } from '../event-log/types.js';
import { readTeamPlan, TeamPlanNotFoundError } from '../planner/index.js';
import {
  buildAgentStoppedEvent,
  buildTeamTearingDownEvent,
  buildTeamTornDownEvent,
  TeamLifecycleManager,
  readTeamRuntimeSnapshot,
  writeTeamRuntimeSnapshot,
  type TeamRuntimeSnapshot
} from '../teams/index.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import type { RepoRef } from '../core/types.js';
import {
  MalformedStateError,
  readState as defaultReadState,
  writeState as defaultWriteState
} from '../workflow/local-state-store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface TeamCommandDeps {
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
  readTeamPlan: typeof readTeamPlan;
  createTeamManager: (input: {
    worktreePath: string;
    issueNumber: number;
  }) => TeamLifecycleManager;
  readTeamRuntimeSnapshot: typeof readTeamRuntimeSnapshot;
  writeTeamRuntimeSnapshot: typeof writeTeamRuntimeSnapshot;
  appendEvent: (input: AppendEventInput) => void;
  env: NodeJS.ProcessEnv;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

function requireEngineGate(subcommand: string, deps: TeamCommandDeps): boolean {
  if (deps.env.ISSUEFLOW_ENGINE === '1') {
    return true;
  }
  deps.write(
    'stderr',
    `issueflow team ${subcommand} is engine-only. Set ISSUEFLOW_ENGINE=1 to authorise the call; agent processes must not bypass the workflow engine.\n`
  );
  deps.setExitCode(3);
  return false;
}

function withCommanderErrorHandling(
  deps: TeamCommandDeps,
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
  deps: TeamCommandDeps,
  issueOverride: number | undefined
): Promise<{ issueNumber: number; repo: RepoRef; worktreePath: string }> {
  const worktreePath = await deps.resolveRepoRoot(process.cwd());
  const issueNumber = await deps.resolveIssueNumber(worktreePath, issueOverride);
  const repo = await deps.resolveRepoRef(process.cwd());
  return { issueNumber, repo, worktreePath };
}

async function cancelTeamFromSnapshot(
  deps: TeamCommandDeps,
  worktreePath: string,
  issueNumber: number,
  snapshot: TeamRuntimeSnapshot
): Promise<void> {
  deps.appendEvent(buildTeamTearingDownEvent(issueNumber, 'cancelled'));
  const stoppedSnapshot: TeamRuntimeSnapshot = {
    ...snapshot,
    phase: 'stopped',
    stoppedAt: new Date().toISOString(),
    stopReason: 'cancelled',
    members: snapshot.members.map((member) => ({
      ...member,
      state: 'stopped'
    }))
  };
  for (const member of stoppedSnapshot.members) {
    deps.appendEvent(buildAgentStoppedEvent(issueNumber, member.memberId, 'cancelled'));
  }
  await deps.writeTeamRuntimeSnapshot(worktreePath, stoppedSnapshot);
  deps.appendEvent(
    buildTeamTornDownEvent(issueNumber, 'cancelled', snapshot.members.length)
  );
}

let defaultEventLog: EventLog | undefined;

function getDefaultEventLog(): EventLog {
  if (!defaultEventLog) {
    defaultEventLog = openEventLog();
  }
  return defaultEventLog;
}

function defaultCreateTeamManager(input: {
  worktreePath: string;
  issueNumber: number;
}): TeamLifecycleManager {
  return new TeamLifecycleManager({
    worktreePath: input.worktreePath,
    issueNumber: input.issueNumber,
    eventLog: getDefaultEventLog(),
    adapterFactory: {
      create: () =>
        new ScriptedAgentAdapter({
          steps: [{ match: /.*/, output: 'ok' }]
        })
    }
  });
}

const defaultDeps: TeamCommandDeps = {
  resolveRepoRoot,
  resolveRepoRef,
  resolveIssueNumber: (worktreePath, override) => resolveIssueNumber(worktreePath, override),
  readState: defaultReadState,
  writeState: defaultWriteState,
  readTeamPlan,
  createTeamManager: defaultCreateTeamManager,
  readTeamRuntimeSnapshot,
  writeTeamRuntimeSnapshot,
  appendEvent: (input) => {
    getDefaultEventLog().append(input);
  },
  env: process.env,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

export function registerTeamCommands(program: Command, deps: TeamCommandDeps = defaultDeps): Command {
  const team = program.command('team').description('Start, inspect, and stop agent teams');

  team
    .command('start')
    .description('Create a team from team-plan.json and transition approved → implementing')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      if (!requireEngineGate('start', deps)) {
        return;
      }

      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, repo, worktreePath } = await resolveIssueContext(deps, options.issue);
        const current = await deps.readState(repo, issueNumber);
        if (current === null) {
          deps.write(
            'stderr',
            `Issue #${issueNumber} has no current workflow state. Initialise it before starting a team.\n`
          );
          deps.setExitCode(1);
          return;
        }
        if (current !== 'approved') {
          deps.write(
            'stderr',
            `Issue #${issueNumber} must be in state "approved" to start a team (current: "${current}").\n`
          );
          deps.setExitCode(1);
          return;
        }

        const definition = await deps.readTeamPlan(worktreePath);
        const manager = deps.createTeamManager({ worktreePath, issueNumber });
        await manager.create(definition);
        await deps.writeState(repo, issueNumber, 'approved', 'implementing');
        const snapshot = manager.status();
        deps.write('stdout', `team started: ${snapshot.members.length} members\n`);
      });
    });

  team
    .command('status')
    .description('Print the team runtime snapshot JSON')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      await withCommanderErrorHandling(deps, async () => {
        const { worktreePath } = await resolveIssueContext(deps, options.issue);
        const snapshot = await deps.readTeamRuntimeSnapshot(worktreePath);
        if (snapshot === null) {
          deps.write('stderr', 'no active team\n');
          deps.setExitCode(2);
          return;
        }
        deps.write('stdout', `${JSON.stringify(snapshot, null, 2)}\n`);
      });
    });

  team
    .command('stop')
    .description('Cancel a running team using the runtime snapshot')
    .addOption(new Option('--issue <number>', 'Issue number').argParser(parseIssueNumber))
    .action(async (options: { issue?: number }) => {
      await withCommanderErrorHandling(deps, async () => {
        const { issueNumber, worktreePath } = await resolveIssueContext(deps, options.issue);
        const snapshot = await deps.readTeamRuntimeSnapshot(worktreePath);
        if (snapshot === null || snapshot.phase === 'stopped') {
          deps.write('stderr', 'no active team\n');
          deps.setExitCode(2);
          return;
        }

        await cancelTeamFromSnapshot(deps, worktreePath, issueNumber, snapshot);
        deps.write('stdout', 'team stopped (cancelled)\n');
      });
    });

  return team;
}

export { TeamPlanNotFoundError };
