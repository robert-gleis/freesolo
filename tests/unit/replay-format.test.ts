import { describe, expect, it } from 'vitest';

import { formatReplayJson, formatReplayText } from '../../src/replay/format.js';
import type { WorkflowReplay } from '../../src/replay/types.js';

const sample: WorkflowReplay = {
  issueId: 32,
  workflowId: 'wf-32',
  startedAt: '2026-06-08T10:00:00.000Z',
  endedAt: '2026-06-08T10:05:00.000Z',
  steps: [
    {
      kind: 'workflow.decision',
      at: '2026-06-08T10:00:00.000Z',
      fromState: 'planned',
      action: { kind: 'wait', reason: 'agent owns work' }
    },
    {
      kind: 'agent.log',
      at: '2026-06-08T10:05:00.000Z',
      agentId: 'agent-1',
      stdout: 'hello',
      stderr: 'warn',
      truncated: false
    }
  ]
};

describe('replay formatters', () => {
  it('formatReplayJson returns parseable JSON', () => {
    const json = formatReplayJson(sample);
    const parsed = JSON.parse(json) as WorkflowReplay;
    expect(parsed.issueId).toBe(32);
    expect(parsed.steps).toHaveLength(2);
  });

  it('formatReplayText includes issue header and log sections', () => {
    const text = formatReplayText(sample);
    expect(text).toContain('Issue #32 Session Replay');
    expect(text).toContain('workflow.decision');
    expect(text).toContain('--- stdout ---');
    expect(text).toContain('hello');
    expect(text).toContain('--- stderr ---');
    expect(text).toContain('warn');
  });
});
