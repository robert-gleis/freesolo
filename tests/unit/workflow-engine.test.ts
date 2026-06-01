import { describe, expect, it, vi } from 'vitest';

import type { AgentAdapter, AgentResponse, AgentStatus } from '../../src/agents/index.js';
import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import {
  InvalidStateLabelError,
  MultipleStateLabelsError
} from '../../src/workflow/state-store.js';
import type { EngineAction, PolicyInput } from '../../src/workflow/policy.js';
import {
  createWorkflowEngine,
  type WorkflowEngine,
  type WorkflowEngineDeps,
  type WorkflowEngineEvent
} from '../../src/workflow/engine.js';

const repo = { owner: 'acme', repo: 'widgets' };
const fixedNow = new Date('2026-06-01T00:00:00.000Z');

interface Harness {
  engine: WorkflowEngine;
  deps: WorkflowEngineDeps;
  events: WorkflowEngineEvent[];
  policy: ReturnType<typeof vi.fn>;
  readState: ReturnType<typeof vi.fn>;
  writeState: ReturnType<typeof vi.fn>;
}

function buildHarness(overrides: Partial<WorkflowEngineDeps> = {}): Harness {
  const readState = vi.fn().mockResolvedValue('implementing');
  const writeState = vi.fn().mockResolvedValue(undefined);
  const policy = vi.fn<(input: PolicyInput) => EngineAction>(() => ({
    kind: 'wait',
    reason: 'default fixture wait'
  }));
  const deps: WorkflowEngineDeps = {
    readState,
    writeState,
    policy,
    now: () => fixedNow,
    ...overrides
  };
  const events: WorkflowEngineEvent[] = [];
  const engine = createWorkflowEngine(deps);
  engine.on((event) => {
    events.push(event);
  });
  return { engine, deps, events, policy, readState, writeState };
}

describe('createWorkflowEngine tick refusals', () => {
  it('refuses with no-state when the issue has no state label', async () => {
    const harness = buildHarness({ readState: vi.fn().mockResolvedValue(null) });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result).toEqual({
      issueNumber: 24,
      fromState: null,
      toState: null,
      action: { kind: 'refuse', reason: 'issue has no state label' },
      refused: { code: 'no-state', reason: 'issue has no state label' }
    });
    expect(harness.events).toEqual([
      {
        kind: 'decision',
        at: fixedNow,
        issueNumber: 24,
        fromState: null,
        action: { kind: 'refuse', reason: 'issue has no state label' }
      }
    ]);
    expect(harness.policy).not.toHaveBeenCalled();
  });

  it('refuses with malformed-state when readState throws MultipleStateLabelsError', async () => {
    const harness = buildHarness({
      readState: vi
        .fn()
        .mockRejectedValue(new MultipleStateLabelsError(24, ['triaged', 'planned']))
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.refused?.code).toBe('malformed-state');
    expect(result.refused?.reason).toContain('multiple workflow state labels');
    expect(result.fromState).toBeNull();
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0].kind).toBe('decision');
    expect(harness.policy).not.toHaveBeenCalled();
  });

  it('refuses with malformed-state when readState throws InvalidStateLabelError', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockRejectedValue(new InvalidStateLabelError(24, ['state:bogus']))
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.refused?.code).toBe('malformed-state');
    expect(harness.policy).not.toHaveBeenCalled();
  });

  it('refuses with terminal-state when the issue is closed', async () => {
    const harness = buildHarness({ readState: vi.fn().mockResolvedValue('closed') });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.fromState).toBe('closed');
    expect(result.refused?.code).toBe('terminal-state');
    expect(harness.policy).not.toHaveBeenCalled();
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0].kind).toBe('decision');
  });
});

describe('createWorkflowEngine tick: wait action', () => {
  it('returns the policy wait reason and emits a single decision event', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('implementing'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({ kind: 'wait', reason: 'agent owns implementation' })
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result).toEqual({
      issueNumber: 24,
      fromState: 'implementing',
      toState: 'implementing',
      action: { kind: 'wait', reason: 'agent owns implementation' }
    });
    expect(harness.writeState).not.toHaveBeenCalled();
    expect(harness.events).toEqual([
      {
        kind: 'decision',
        at: fixedNow,
        issueNumber: 24,
        fromState: 'implementing',
        action: { kind: 'wait', reason: 'agent owns implementation' }
      }
    ]);
  });
});
