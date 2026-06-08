import { describe, expect, it } from 'vitest';

import {
  buildAgentCreatedEvent,
  buildAgentStoppedEvent,
  buildTeamCreatedEvent,
  buildTeamMemberBlockedEvent,
  buildTeamTearingDownEvent,
  buildTeamTornDownEvent
} from '../../src/teams/events.js';

describe('team event builders', () => {
  it('builds agent.created payload', () => {
    const event = buildAgentCreatedEvent(41, {
      memberId: 'backend-1',
      roleName: 'Backend',
      host: 'cursor',
      responsibility: 'API',
      index: 1
    });
    expect(event).toMatchObject({
      eventType: 'agent.created',
      agentId: 'backend-1',
      issueId: 41
    });
  });

  it('builds team.created payload', () => {
    const event = buildTeamCreatedEvent(41, ['backend-1']);
    expect(event.eventType).toBe('team.created');
    expect(event.payload).toMatchObject({ memberCount: 1, memberIds: ['backend-1'] });
  });

  it('builds team.member.blocked payload', () => {
    const event = buildTeamMemberBlockedEvent(41, 'backend-1', 'inactivity');
    expect(event.eventType).toBe('team.member.blocked');
  });

  it('builds teardown payloads', () => {
    expect(buildTeamTearingDownEvent(41, 'cancelled').eventType).toBe('team.tearing-down');
    expect(buildTeamTornDownEvent(41, 'cancelled', 2).eventType).toBe('team.torn-down');
    expect(buildAgentStoppedEvent(41, 'backend-1', 'completed').eventType).toBe('agent.stopped');
  });
});
