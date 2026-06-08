import type { AgentAdapter, AgentState, AgentStatus } from '../agents/types.js';
import type { PlannerHost } from '../planner/schemas/team-definition.js';

export type AgentHost = PlannerHost;

export type TeamPhase =
  | 'idle'
  | 'creating'
  | 'running'
  | 'tearing-down'
  | 'stopped';

export interface TeamMemberSpec {
  memberId: string;
  roleName: string;
  host: AgentHost;
  responsibility: string;
  index: number;
}

export interface TeamMemberRuntime {
  spec: TeamMemberSpec;
  adapter: AgentAdapter;
  status: AgentStatus;
  blockedAt?: Date;
  blockedReason?: string;
  startFailed?: boolean;
}

export interface TeamRuntimeSnapshot {
  issueNumber: number;
  phase: TeamPhase;
  startedAt?: string;
  stoppedAt?: string;
  stopReason?: TeamStopReason;
  members: Array<{
    memberId: string;
    roleName: string;
    host: AgentHost;
    state: AgentState;
    blockedReason?: string;
  }>;
}

export type TeamStopReason = 'completed' | 'cancelled' | 'timeout' | 'error';

export interface TeamLifecycleConfig {
  pollIntervalMs: number;
  memberBlockedTimeoutMs: number;
  teamTimeoutMs?: number;
}

export const DEFAULT_TEAM_LIFECYCLE_CONFIG: TeamLifecycleConfig = {
  pollIntervalMs: 5_000,
  memberBlockedTimeoutMs: 1_800_000
};
