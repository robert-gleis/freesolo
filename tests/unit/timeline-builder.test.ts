import { describe, expect, it } from 'vitest';

import { buildTimeline } from '../../src/timeline/builder.js';
import type { EventRecord, EventType } from '../../src/event-log/types.js';

function event(
  id: number,
  eventType: EventType,
  createdAt: string,
  payload: Record<string, unknown> = {}
): EventRecord {
  return {
    id,
    eventType,
    agentId: null,
    issueId: 31,
    workflowId: null,
    payload,
    schemaVersion: 1,
    createdAt
  };
}

describe('buildTimeline', () => {
  it('returns all pending steps when no events are provided', () => {
    const timeline = buildTimeline(31, []);

    expect(timeline.hasActivity).toBe(false);
    expect(timeline.steps.every((step) => step.status === 'pending')).toBe(true);
  });

  it('marks plan.approved alone as planned completed with activity', () => {
    const timeline = buildTimeline(31, [event(1, 'plan.approved', '2026-06-08T10:00:00.000Z')]);

    expect(timeline.hasActivity).toBe(true);
    expect(timeline.steps.find((step) => step.id === 'planned')?.status).toBe('completed');
    expect(timeline.steps.find((step) => step.id === 'planned')?.completedAt).toBe('2026-06-08T10:00:00.000Z');
  });

  it('maps team.planned to the planned step', () => {
    const timeline = buildTimeline(31, [event(1, 'team.planned', '2026-06-08T10:00:00.000Z')]);

    expect(timeline.steps.find((step) => step.id === 'planned')?.status).toBe('completed');
  });

  it('builds a happy-path pipeline through pr.created', () => {
    const timeline = buildTimeline(31, [
      event(1, 'plan.approved', '2026-06-08T10:00:00.000Z'),
      event(2, 'workflow.transition', '2026-06-08T11:00:00.000Z', {
        from: 'planned',
        to: 'implementing'
      }),
      event(3, 'workflow.transition', '2026-06-08T12:00:00.000Z', {
        from: 'implementing',
        to: 'reviewing'
      }),
      event(4, 'verification.passed', '2026-06-08T13:00:00.000Z'),
      event(5, 'pr.created', '2026-06-08T14:00:00.000Z', { branchName: 'candidate/31-x' })
    ]);

    expect(timeline.steps.map((step) => step.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed'
    ]);
  });

  it('records verification failure then success as retry attempts', () => {
    const timeline = buildTimeline(31, [
      event(1, 'verification.failed', '2026-06-08T12:00:00.000Z', { detail: 'tests failed' }),
      event(2, 'verification.passed', '2026-06-08T13:00:00.000Z')
    ]);

    const verified = timeline.steps.find((step) => step.id === 'verified');
    expect(verified?.attempts).toHaveLength(2);
    expect(verified?.status).toBe('completed');
    expect(verified?.startedAt).toBe('2026-06-08T12:00:00.000Z');
    expect(verified?.completedAt).toBe('2026-06-08T13:00:00.000Z');
  });

  it('records review gate findings then pass', () => {
    const timeline = buildTimeline(31, [
      event(1, 'review.gate.completed', '2026-06-08T12:00:00.000Z', {
        gate: 'implementation',
        round: 1,
        status: 'pass_with_findings'
      }),
      event(2, 'review.gate.completed', '2026-06-08T13:00:00.000Z', {
        gate: 'implementation',
        round: 2,
        status: 'pass'
      })
    ]);

    const reviewed = timeline.steps.find((step) => step.id === 'reviewed');
    expect(reviewed?.attempts).toHaveLength(2);
    expect(reviewed?.status).toBe('completed');
  });

  it('records review gate block as failed reviewed step', () => {
    const timeline = buildTimeline(31, [
      event(1, 'review.gate.completed', '2026-06-08T12:00:00.000Z', {
        gate: 'plan',
        round: 5,
        status: 'block'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'reviewed')?.status).toBe('failed');
  });

  it('records workflow.refused on the inferred step', () => {
    const timeline = buildTimeline(31, [
      event(1, 'workflow.refused', '2026-06-08T12:00:00.000Z', {
        fromState: 'reviewing',
        code: 'refuse',
        reason: 'policy refused'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'reviewed')?.status).toBe('failed');
  });

  it('handles backward transitions as retry semantics', () => {
    const timeline = buildTimeline(31, [
      event(1, 'workflow.transition', '2026-06-08T12:00:00.000Z', {
        from: 'verifying',
        to: 'implementing'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'verified')?.attempts.at(-1)?.status).toBe('failed');
    expect(timeline.steps.find((step) => step.id === 'implemented')?.status).toBe('completed');
  });

  it('ignores malformed workflow.transition payloads without throwing', () => {
    const timeline = buildTimeline(31, [event(1, 'workflow.transition', '2026-06-08T12:00:00.000Z', {})]);

    expect(timeline.hasActivity).toBe(false);
    expect(timeline.steps.every((step) => step.status === 'pending')).toBe(true);
  });

  it('marks the latest touched step in progress for partial pipelines', () => {
    const timeline = buildTimeline(31, [
      event(1, 'plan.approved', '2026-06-08T10:00:00.000Z'),
      event(2, 'workflow.transition', '2026-06-08T11:00:00.000Z', {
        from: 'approved',
        to: 'implementing'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'planned')?.status).toBe('completed');
    expect(timeline.steps.find((step) => step.id === 'implemented')?.status).toBe('completed');
    expect(timeline.steps.find((step) => step.id === 'reviewed')?.status).toBe('pending');
  });

  it('keeps later steps pending when an earlier step failed', () => {
    const timeline = buildTimeline(31, [
      event(1, 'review.gate.completed', '2026-06-08T12:00:00.000Z', {
        gate: 'implementation',
        round: 5,
        status: 'block'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'reviewed')?.status).toBe('failed');
    expect(timeline.steps.find((step) => step.id === 'verified')?.status).toBe('pending');
  });

  it('derives in_progress when the highest touched step has only failed attempts', () => {
    const timeline = buildTimeline(31, [
      event(1, 'plan.approved', '2026-06-08T10:00:00.000Z'),
      event(2, 'workflow.transition', '2026-06-08T11:00:00.000Z', {
        from: 'approved',
        to: 'implementing'
      }),
      event(3, 'workflow.refused', '2026-06-08T12:00:00.000Z', {
        fromState: 'implementing',
        code: 'refuse',
        reason: 'waiting for agent'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'implemented')?.status).toBe('in_progress');
  });

  it('maps workflow.refused without fromState onto the inferred in-progress step', () => {
    const timeline = buildTimeline(31, [
      event(1, 'plan.approved', '2026-06-08T10:00:00.000Z'),
      event(2, 'workflow.refused', '2026-06-08T11:00:00.000Z', {
        code: 'refuse',
        reason: 'no-state'
      })
    ]);

    expect(timeline.steps.find((step) => step.id === 'implemented')?.attempts).toHaveLength(1);
    expect(timeline.steps.find((step) => step.id === 'implemented')?.attempts[0]?.status).toBe('failed');
  });
});
