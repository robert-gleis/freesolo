import { describe, expect, it } from 'vitest';

import { buildTeamPlannedEvent } from '../../src/policy/events.js';

describe('buildTeamPlannedEvent', () => {
  it('builds team.planned with teamPlanPath and autonomous flag', () => {
    const event = buildTeamPlannedEvent(45, '/repo/.git/freesolo/team-plan.json');
    expect(event).toEqual({
      eventType: 'team.planned',
      issueId: 45,
      payload: {
        teamPlanPath: '/repo/.git/freesolo/team-plan.json',
        autonomous: true
      }
    });
  });
});
