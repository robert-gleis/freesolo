import type { AppendEventInput } from '../event-log/types.js';
import type { TeamMemberSpec, TeamStopReason } from './types.js';

export function buildAgentCreatedEvent(
  issueNumber: number,
  member: TeamMemberSpec
): AppendEventInput {
  return {
    eventType: 'agent.created',
    agentId: member.memberId,
    issueId: issueNumber,
    payload: {
      memberId: member.memberId,
      roleName: member.roleName,
      host: member.host,
      responsibility: member.responsibility
    }
  };
}

export function buildTeamCreatedEvent(
  issueNumber: number,
  memberIds: string[]
): AppendEventInput {
  return {
    eventType: 'team.created',
    issueId: issueNumber,
    payload: {
      issueNumber,
      memberCount: memberIds.length,
      memberIds
    }
  };
}

export function buildTeamMemberBlockedEvent(
  issueNumber: number,
  memberId: string,
  reason: string,
  error?: string
): AppendEventInput {
  return {
    eventType: 'team.member.blocked',
    agentId: memberId,
    issueId: issueNumber,
    payload: {
      memberId,
      reason,
      ...(error ? { error } : {})
    }
  };
}

export function buildTeamTearingDownEvent(
  issueNumber: number,
  reason: TeamStopReason
): AppendEventInput {
  return {
    eventType: 'team.tearing-down',
    issueId: issueNumber,
    payload: { reason }
  };
}

export function buildAgentStoppedEvent(
  issueNumber: number,
  memberId: string,
  reason: string
): AppendEventInput {
  return {
    eventType: 'agent.stopped',
    agentId: memberId,
    issueId: issueNumber,
    payload: { memberId, reason }
  };
}

export function buildTeamTornDownEvent(
  issueNumber: number,
  reason: TeamStopReason,
  memberCount: number
): AppendEventInput {
  return {
    eventType: 'team.torn-down',
    issueId: issueNumber,
    payload: { reason, memberCount }
  };
}
