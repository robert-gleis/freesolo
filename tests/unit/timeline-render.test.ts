import { describe, expect, it } from 'vitest';

import { renderTimelineJson, renderTimelineText } from '../../src/timeline/render.js';
import type { Timeline } from '../../src/timeline/types.js';

const sampleTimeline: Timeline = {
  issueNumber: 123,
  hasActivity: true,
  steps: [
    {
      id: 'planned',
      label: 'Planned',
      status: 'completed',
      startedAt: '2026-06-08T10:00:00.000Z',
      completedAt: '2026-06-08T10:00:00.000Z',
      attempts: [
        {
          at: '2026-06-08T10:00:00.000Z',
          status: 'completed',
          eventId: 1
        }
      ]
    },
    {
      id: 'implemented',
      label: 'Implemented',
      status: 'in_progress',
      startedAt: '2026-06-08T11:00:00.000Z',
      completedAt: null,
      attempts: [
        {
          at: '2026-06-08T11:00:00.000Z',
          status: 'failed',
          detail: 'waiting for agent',
          eventId: 2
        }
      ]
    },
    {
      id: 'reviewed',
      label: 'Reviewed',
      status: 'pending',
      startedAt: null,
      completedAt: null,
      attempts: []
    },
    {
      id: 'verified',
      label: 'Verified',
      status: 'pending',
      startedAt: null,
      completedAt: null,
      attempts: []
    },
    {
      id: 'pr-created',
      label: 'PR Created',
      status: 'pending',
      startedAt: null,
      completedAt: null,
      attempts: []
    }
  ]
};

describe('timeline render', () => {
  it('serialises timeline as JSON', () => {
    const json = renderTimelineJson(sampleTimeline);
    expect(JSON.parse(json)).toEqual(sampleTimeline);
  });

  it('renders text with issue header, timestamps, and markers', () => {
    const text = renderTimelineText(sampleTimeline);

    expect(text).toContain('Issue #123');
    expect(text).toContain('Planned');
    expect(text).toContain('2026-06-08T10:00:00.000Z');
    expect(text).toContain('✓');
    expect(text).toContain('Implemented');
    expect(text).toContain('✗');
    expect(text).toContain('pending');
  });

  it('prints startedAt for in_progress steps via attempt timestamps', () => {
    const text = renderTimelineText(sampleTimeline);

    expect(text).toContain('2026-06-08T11:00:00.000Z');
    expect(text).toContain('waiting for agent');
  });
});
