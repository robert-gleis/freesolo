import { describe, expect, it } from 'vitest';

import {
  CURRENT_EVENT_SCHEMA_VERSION,
  EVENT_TYPES,
  EventLogError,
  type AppendEventInput,
  type EventLog,
  type EventQuery,
  type EventRecord,
  type EventType
} from '../../src/event-log/types.js';

describe('event-log types', () => {
  it('exports the eight canonical event types from issue #23', () => {
    expect([...EVENT_TYPES]).toEqual([
      'agent.created',
      'agent.stopped',
      'issue.assigned',
      'verification.failed',
      'verification.passed',
      'team.planned',
      'plan.approved',
      'decomposition.applied'
    ]);
  });

  it('pins CURRENT_EVENT_SCHEMA_VERSION to 1', () => {
    expect(CURRENT_EVENT_SCHEMA_VERSION).toBe(1);
  });

  it('EventLogError carries a typed code', () => {
    const err = new EventLogError('invalid-event-type', 'bad type');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('EventLogError');
    expect(err.code).toBe('invalid-event-type');
    expect(err.message).toBe('bad type');
  });

  it('type-level: EventType is drawn from EVENT_TYPES', () => {
    const sample: EventType = 'agent.created';
    const input: AppendEventInput = { eventType: sample, issueId: 23 };
    const record: EventRecord = {
      id: 1,
      eventType: input.eventType,
      agentId: null,
      issueId: 23,
      workflowId: null,
      payload: {},
      schemaVersion: CURRENT_EVENT_SCHEMA_VERSION,
      createdAt: '2026-06-05T12:00:00.000Z'
    };
    const query: EventQuery = { eventType: record.eventType };
    const log: EventLog = {
      path: '/tmp/state.db',
      append: () => record,
      list: () => [record],
      close: () => {}
    };
    expect(query.eventType).toBe('agent.created');
    expect(log.path).toBe('/tmp/state.db');
  });
});
