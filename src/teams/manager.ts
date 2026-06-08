import type { AgentAdapter } from '../agents/types.js';
import type { EventLog } from '../event-log/types.js';
import type { TeamDefinition } from '../planner/schemas/team-definition.js';
import { TeamLifecycleError } from './errors.js';
import {
  buildAgentCreatedEvent,
  buildAgentStoppedEvent,
  buildTeamCreatedEvent,
  buildTeamMemberBlockedEvent,
  buildTeamTearingDownEvent,
  buildTeamTornDownEvent
} from './events.js';
import { expandTeamDefinition } from './members.js';
import {
  isMemberBlockedTooLong,
  isMemberInactive,
  isTeamComplete,
  isTeamTimedOut
} from './monitor.js';
import { buildMemberPrompt } from './prompt.js';
import { writeTeamRuntimeSnapshot } from './store.js';
import {
  DEFAULT_TEAM_LIFECYCLE_CONFIG,
  type TeamLifecycleConfig,
  type TeamMemberRuntime,
  type TeamMemberSpec,
  type TeamPhase,
  type TeamRuntimeSnapshot,
  type TeamStopReason
} from './types.js';

export interface AgentAdapterFactory {
  create(input: { member: TeamMemberSpec; workingDirectory: string }): AgentAdapter;
}

export interface TeamLifecycleManagerDeps {
  worktreePath: string;
  issueNumber: number;
  adapterFactory: AgentAdapterFactory;
  eventLog: EventLog;
  config?: Partial<TeamLifecycleConfig>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export class TeamLifecycleManager {
  private readonly deps: TeamLifecycleManagerDeps;
  private readonly config: TeamLifecycleConfig;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private phase: TeamPhase = 'idle';
  private startedAt?: Date;
  private stoppedAt?: Date;
  private stopReason?: TeamStopReason;
  private members: TeamMemberRuntime[] = [];
  private monitoring = false;

  constructor(deps: TeamLifecycleManagerDeps) {
    this.deps = deps;
    this.config = { ...DEFAULT_TEAM_LIFECYCLE_CONFIG, ...deps.config };
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  status(): TeamRuntimeSnapshot {
    return this.buildSnapshot();
  }

  async create(definition: TeamDefinition): Promise<void> {
    if (this.phase !== 'idle') {
      throw new TeamLifecycleError('invalid-state', `Cannot create team from phase "${this.phase}"`);
    }

    this.phase = 'creating';
    const specs = expandTeamDefinition(definition);
    this.members = [];

    let startedCount = 0;

    for (const spec of specs) {
      const adapter = this.deps.adapterFactory.create({
        member: spec,
        workingDirectory: this.deps.worktreePath
      });

      const runtime: TeamMemberRuntime = {
        spec,
        adapter,
        status: { state: 'idle' }
      };
      this.members.push(runtime);

      try {
        await adapter.start({
          workingDirectory: this.deps.worktreePath,
          initialInstructions: buildMemberPrompt(spec, this.deps.issueNumber)
        });
        runtime.status = await adapter.status();
        startedCount += 1;
        this.deps.eventLog.append(buildAgentCreatedEvent(this.deps.issueNumber, spec));
      } catch {
        runtime.status = { state: 'error', error: 'start-failed' };
        runtime.startFailed = true;
        this.deps.eventLog.append(
          buildAgentStoppedEvent(this.deps.issueNumber, spec.memberId, 'start-failed')
        );
      }
    }

    if (startedCount === 0) {
      await this.tearDown('error');
      return;
    }

    this.phase = 'running';
    this.startedAt = this.now();
    this.deps.eventLog.append(
      buildTeamCreatedEvent(
        this.deps.issueNumber,
        this.members.map((member) => member.spec.memberId)
      )
    );
    await this.persistSnapshot();
  }

  async monitor(): Promise<TeamStopReason> {
    if (this.phase !== 'running') {
      throw new TeamLifecycleError('invalid-state', `Cannot monitor team in phase "${this.phase}"`);
    }
    if (this.monitoring) {
      throw new TeamLifecycleError('invalid-state', 'Monitor loop is already running');
    }

    this.monitoring = true;

    try {
      while (this.phase === 'running') {
        const now = this.now();

        for (const member of this.members) {
          member.status = await member.adapter.status();

          if (member.status.state === 'error') {
            if (member.blockedReason !== 'error') {
              member.blockedAt = now;
              member.blockedReason = 'error';
              this.deps.eventLog.append(
                buildTeamMemberBlockedEvent(
                  this.deps.issueNumber,
                  member.spec.memberId,
                  'error',
                  member.status.error
                )
              );
            }
          } else if (
            isMemberInactive(
              member.status,
              member.status.startedAt,
              now,
              this.config.memberBlockedTimeoutMs
            )
          ) {
            if (member.blockedReason !== 'inactivity') {
              member.blockedAt = now;
              member.blockedReason = 'inactivity';
              this.deps.eventLog.append(
                buildTeamMemberBlockedEvent(
                  this.deps.issueNumber,
                  member.spec.memberId,
                  'inactivity'
                )
              );
            }
          }
        }

        const memberStates = this.members.map((member) => member.status.state);
        if (isTeamComplete(memberStates)) {
          return this.tearDown('completed');
        }

        if (isTeamTimedOut(this.startedAt, now, this.config.teamTimeoutMs)) {
          return this.tearDown('timeout');
        }

        const blockedTooLong = this.members.some((member) =>
          isMemberBlockedTooLong(
            member.blockedAt,
            now,
            this.config.memberBlockedTimeoutMs
          )
        );
        if (blockedTooLong) {
          return this.tearDown('timeout');
        }

        const allTerminal = memberStates.every(
          (state) => state === 'stopped' || state === 'error'
        );
        if (allTerminal && memberStates.some((state) => state === 'error')) {
          return this.tearDown('error');
        }

        await this.persistSnapshot();
        await this.sleep(this.config.pollIntervalMs);
      }

      return this.stopReason ?? 'cancelled';
    } finally {
      this.monitoring = false;
    }
  }

  async tearDown(reason: TeamStopReason): Promise<TeamStopReason> {
    if (this.phase === 'stopped') {
      return this.stopReason ?? reason;
    }

    this.phase = 'tearing-down';
    this.deps.eventLog.append(buildTeamTearingDownEvent(this.deps.issueNumber, reason));

    for (const member of this.members) {
      if (member.status.state !== 'stopped' && member.status.state !== 'idle') {
        try {
          await member.adapter.stop();
        } catch {
          // Best-effort stop.
        }
        member.status = await member.adapter.status();
      }

      if (!member.startFailed) {
        this.deps.eventLog.append(
          buildAgentStoppedEvent(this.deps.issueNumber, member.spec.memberId, reason)
        );
      }
    }

    this.phase = 'stopped';
    this.stoppedAt = this.now();
    this.stopReason = reason;
    this.deps.eventLog.append(
      buildTeamTornDownEvent(this.deps.issueNumber, reason, this.members.length)
    );
    await this.persistSnapshot();
    return reason;
  }

  private buildSnapshot(): TeamRuntimeSnapshot {
    return {
      issueNumber: this.deps.issueNumber,
      phase: this.phase,
      startedAt: this.startedAt?.toISOString(),
      stoppedAt: this.stoppedAt?.toISOString(),
      stopReason: this.stopReason,
      members: this.members.map((member) => ({
        memberId: member.spec.memberId,
        roleName: member.spec.roleName,
        host: member.spec.host,
        state: member.status.state,
        blockedReason: member.blockedReason
      }))
    };
  }

  private async persistSnapshot(): Promise<void> {
    await writeTeamRuntimeSnapshot(this.deps.worktreePath, this.buildSnapshot());
  }
}
