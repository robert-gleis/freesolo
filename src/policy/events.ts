import type { AppendEventInput } from '../event-log/types.js';

export function buildTeamPlannedEvent(
  issueNumber: number,
  teamPlanPath: string
): AppendEventInput {
  return {
    eventType: 'team.planned',
    issueId: issueNumber,
    payload: {
      teamPlanPath,
      autonomous: true
    }
  };
}
