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
  const deps: WorkflowEngineDeps = {
    readState: vi.fn().mockResolvedValue('implementing'),
    writeState: vi.fn().mockResolvedValue(undefined),
    policy: vi.fn<(input: PolicyInput) => EngineAction>(() => ({
      kind: 'wait',
      reason: 'default fixture wait'
    })),
    now: () => fixedNow,
    ...overrides
  };
  const events: WorkflowEngineEvent[] = [];
  const engine = createWorkflowEngine(deps);
  engine.on((event) => {
    events.push(event);
  });
  return {
    engine,
    deps,
    events,
    policy: deps.policy as unknown as ReturnType<typeof vi.fn>,
    readState: deps.readState as unknown as ReturnType<typeof vi.fn>,
    writeState: deps.writeState as unknown as ReturnType<typeof vi.fn>
  };
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

describe('createWorkflowEngine tick: transition action', () => {
  it('calls writeState, emits decision then transition events, and returns the new state', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('merged'),
      writeState: vi.fn().mockResolvedValue(undefined),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({ kind: 'transition', to: 'closed' })
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(harness.writeState).toHaveBeenCalledWith(repo, 24, 'merged', 'closed');
    expect(result).toEqual({
      issueNumber: 24,
      fromState: 'merged',
      toState: 'closed',
      action: { kind: 'transition', to: 'closed' }
    });
    expect(harness.events).toEqual([
      {
        kind: 'decision',
        at: fixedNow,
        issueNumber: 24,
        fromState: 'merged',
        action: { kind: 'transition', to: 'closed' }
      },
      {
        kind: 'transition',
        at: fixedNow,
        issueNumber: 24,
        from: 'merged',
        to: 'closed'
      }
    ]);
  });

  it('translates InvalidTransitionError from writeState into a refused result', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('triaged'),
      writeState: vi
        .fn()
        .mockRejectedValue(new InvalidTransitionError('triaged', 'closed', ['planned'])),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({ kind: 'transition', to: 'closed' })
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.refused?.code).toBe('invalid-transition');
    expect(result.refused?.reason).toContain('Invalid workflow transition');
    expect(result.toState).toBeNull();
    expect(result.action).toEqual({ kind: 'transition', to: 'closed' });
    expect(harness.events.filter((event) => event.kind === 'transition')).toHaveLength(0);
    expect(harness.events.filter((event) => event.kind === 'decision')).toHaveLength(1);
  });
});
