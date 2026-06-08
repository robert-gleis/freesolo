import type { AgentState, AgentStatus } from '../agents/types.js';

export function isMemberInactive(
  status: AgentStatus,
  memberStartedAt: Date | undefined,
  now: Date,
  timeoutMs: number
): boolean {
  if (status.state !== 'running') {
    return false;
  }

  const reference = status.lastActivityAt ?? memberStartedAt;
  if (!reference) {
    return false;
  }

  return now.getTime() - reference.getTime() > timeoutMs;
}

export function isTeamComplete(memberStates: AgentState[]): boolean {
  return memberStates.length > 0 && memberStates.every((state) => state === 'stopped');
}

export function isTeamTimedOut(
  startedAt: Date | undefined,
  now: Date,
  teamTimeoutMs: number | undefined
): boolean {
  if (!startedAt || teamTimeoutMs === undefined) {
    return false;
  }

  return now.getTime() - startedAt.getTime() > teamTimeoutMs;
}

export function isMemberBlockedTooLong(
  blockedAt: Date | undefined,
  now: Date,
  timeoutMs: number
): boolean {
  if (!blockedAt) {
    return false;
  }

  return now.getTime() - blockedAt.getTime() > timeoutMs;
}
