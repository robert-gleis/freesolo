import { describe, expect, it, vi } from 'vitest';

import type { AgentAdapter, AgentResponse, AgentStatus } from '../../src/agents/index.js';
import type { AppendEventInput } from '../../src/event-log/types.js';
import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import { MalformedStateError } from '../../src/workflow/local-state-store.js';
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

  it('refuses with malformed-state when readState throws MalformedStateError', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockRejectedValue(new MalformedStateError(24, 'bogus'))
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.refused?.code).toBe('malformed-state');
    expect(result.refused?.reason).toContain('unrecognised state');
    expect(result.fromState).toBeNull();
    expect(harness.events).toHaveLength(1);
    expect(harness.events[0].kind).toBe('decision');
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

describe('createWorkflowEngine event subscribers', () => {
  it('delivers every event to every subscriber', async () => {
    const seenA: WorkflowEngineEvent[] = [];
    const seenB: WorkflowEngineEvent[] = [];
    const engine = createWorkflowEngine({
      readState: vi.fn().mockResolvedValue('merged'),
      writeState: vi.fn().mockResolvedValue(undefined),
      policy: () => ({ kind: 'transition', to: 'closed' }),
      now: () => fixedNow
    });
    engine.on((event) => {
      seenA.push(event);
    });
    engine.on((event) => {
      seenB.push(event);
    });

    await engine.tick({ repo, issueNumber: 24 });

    expect(seenA.map((event) => event.kind)).toEqual(['decision', 'transition']);
    expect(seenB.map((event) => event.kind)).toEqual(['decision', 'transition']);
  });

  it('continues to deliver events even when a subscriber throws', async () => {
    const events: WorkflowEngineEvent[] = [];
    const engine = createWorkflowEngine({
      readState: vi.fn().mockResolvedValue('merged'),
      writeState: vi.fn().mockResolvedValue(undefined),
      policy: () => ({ kind: 'transition', to: 'closed' }),
      now: () => fixedNow
    });
    engine.on(() => {
      throw new Error('logger boom');
    });
    engine.on((event) => {
      events.push(event);
    });

    const result = await engine.tick({ repo, issueNumber: 24 });

    expect(result.refused).toBeUndefined();
    expect(events).toHaveLength(2);
  });

  it('stops sending events after the subscriber unsubscribes', async () => {
    const events: WorkflowEngineEvent[] = [];
    const engine = createWorkflowEngine({
      readState: vi.fn().mockResolvedValue('merged'),
      writeState: vi.fn().mockResolvedValue(undefined),
      policy: () => ({ kind: 'transition', to: 'closed' }),
      now: () => fixedNow
    });
    const unsubscribe = engine.on((event) => {
      events.push(event);
    });
    unsubscribe();

    await engine.tick({ repo, issueNumber: 24 });

    expect(events).toEqual([]);
  });
});

function buildFakeAgent(): AgentAdapter & {
  startCalls: Array<{ workingDirectory: string; initialInstructions?: string }>;
  sendCalls: string[];
  stopCalls: number;
} {
  const startCalls: Array<{ workingDirectory: string; initialInstructions?: string }> = [];
  const sendCalls: string[] = [];
  let stopCalls = 0;
  const agent: AgentAdapter = {
    async start(input) {
      startCalls.push(input);
    },
    async stop() {
      stopCalls += 1;
    },
    async send(input): Promise<AgentResponse> {
      sendCalls.push(input);
      return { output: 'ok' };
    },
    async status(): Promise<AgentStatus> {
      return { state: 'running' };
    }
  };
  return Object.assign(agent, {
    startCalls,
    sendCalls,
    get stopCalls() {
      return stopCalls;
    }
  });
}

describe('createWorkflowEngine tick: spawn action', () => {
  it('refuses with no-agent-adapter when policy asks for spawn but none is configured', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('approved'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: { workingDirectory: '/tmp/wt', initialInstructions: 'go' },
          nextState: 'implementing'
        })
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.refused?.code).toBe('no-agent-adapter');
    expect(harness.writeState).not.toHaveBeenCalled();
    expect(harness.events.filter((event) => event.kind === 'decision')).toHaveLength(1);
    expect(harness.events.filter((event) => event.kind === 'transition')).toHaveLength(0);
  });

  it('starts the agent, sends the initial instructions once, then writes the next state', async () => {
    const agent = buildFakeAgent();
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('approved'),
      writeState: vi.fn().mockResolvedValue(undefined),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: { workingDirectory: '/tmp/wt', initialInstructions: 'continue issueflow' },
          nextState: 'implementing'
        }),
      agent
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(agent.startCalls).toHaveLength(1);
    expect(agent.startCalls[0]?.workingDirectory).toBe('/tmp/wt');
    expect(agent.startCalls[0]?.initialInstructions).toContain('## Your Role');
    expect(agent.startCalls[0]?.initialInstructions).toContain('continue issueflow');
    expect(agent.sendCalls).toHaveLength(1);
    expect(agent.sendCalls[0]).toContain('## Your Role');
    expect(agent.sendCalls[0]).toContain('continue issueflow');
    expect(harness.writeState).toHaveBeenCalledWith(repo, 24, 'approved', 'implementing');
    expect(result.toState).toBe('implementing');
    expect(harness.events.map((event) => event.kind)).toEqual(['decision', 'transition']);
  });

  it('enriches spawn instructions with knowledge entries before start and send', async () => {
    const knowledgeEntries = [
      { filename: 'test.md', title: 'Test', content: 'npm test' }
    ];
    const loadKnowledgeEntries = vi.fn(async () => knowledgeEntries);
    const agent = buildFakeAgent();
    const harness = buildHarness({
      agent,
      readState: vi.fn().mockResolvedValue('approved'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: {
            workingDirectory: '/tmp/wt',
            initialInstructions: 'continue issueflow'
          },
          nextState: 'implementing'
        }),
      loadKnowledgeEntries
    });

    await harness.engine.tick({ repo, issueNumber: 24 });

    expect(loadKnowledgeEntries).toHaveBeenCalledWith('/tmp/wt');
    expect(agent.startCalls).toHaveLength(1);
    const enriched = agent.startCalls[0]?.initialInstructions;
    expect(enriched).toContain('## Your Role');
    expect(enriched).toContain('continue issueflow');
    expect(enriched).toContain('## Factory Knowledge Base');
    expect(enriched).toContain('npm test');
    expect(agent.sendCalls).toEqual([enriched]);
  });

  it('applies default role prompt, logs spawn, and calls appendEvent when configured', async () => {
    const logLines: string[] = [];
    const appended: AppendEventInput[] = [];
    const agent = buildFakeAgent();
    const harness = buildHarness({
      agent,
      readState: vi.fn().mockResolvedValue('approved'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: { workingDirectory: '/tmp/wt', initialInstructions: 'continue issueflow' },
          nextState: 'implementing'
        }),
      logSpawn: (line) => logLines.push(line),
      appendEvent: (input) => appended.push(input)
    });

    await harness.engine.tick({ repo, issueNumber: 42 });

    const enriched = agent.startCalls[0]?.initialInstructions;
    expect(enriched).toContain('## Your Role');
    expect(enriched).toContain('Implementer');
    expect(logLines[0]).toContain('agent=agent-42-implementer-1');
    expect(appended[0]).toMatchObject({
      eventType: 'agent.created',
      agentId: 'agent-42-implementer-1',
      issueId: 42,
      payload: expect.objectContaining({ roleName: 'Implementer' })
    });
  });

  it('uses explicit role and agentId from the spawn action when provided', async () => {
    const logLines: string[] = [];
    const appended: AppendEventInput[] = [];
    const agent = buildFakeAgent();
    const harness = buildHarness({
      agent,
      readState: vi.fn().mockResolvedValue('approved'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: {
            agentId: 'custom-agent-id',
            role: {
              roleName: 'Reviewer',
              responsibility: 'Review PR',
              host: 'claude',
              instanceIndex: 1,
              instanceCount: 1
            },
            workingDirectory: '/tmp/wt',
            initialInstructions: 'review now'
          },
          nextState: 'implementing'
        }),
      logSpawn: (line) => logLines.push(line),
      appendEvent: (input) => appended.push(input)
    });

    await harness.engine.tick({ repo, issueNumber: 42 });

    expect(agent.startCalls[0]?.initialInstructions).toContain('Reviewer');
    expect(agent.startCalls[0]?.initialInstructions).toContain('review now');
    expect(logLines[0]).toContain('agent=custom-agent-id');
    expect(appended[0]).toMatchObject({
      eventType: 'agent.created',
      agentId: 'custom-agent-id',
      payload: expect.objectContaining({ roleName: 'Reviewer', host: 'claude' })
    });
  });

  it('translates InvalidTransitionError from the spawn writeState into a refused result', async () => {
    const agent = buildFakeAgent();
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('approved'),
      writeState: vi
        .fn()
        .mockRejectedValue(new InvalidTransitionError('approved', 'closed', ['implementing'])),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: { workingDirectory: '/tmp/wt', initialInstructions: 'go' },
          nextState: 'closed'
        }),
      agent
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result.refused?.code).toBe('invalid-transition');
    expect(agent.sendCalls[0]).toContain('## Your Role');
    expect(agent.sendCalls[0]).toContain('go');
    expect(harness.events.filter((event) => event.kind === 'transition')).toHaveLength(0);
  });

  it('lets adapter errors during start propagate (engine is one-shot, no retry)', async () => {
    const failingAgent: AgentAdapter = {
      async start() {
        throw new Error('agent failed to start');
      },
      async stop() {},
      async send() {
        throw new Error('unreachable');
      },
      async status() {
        return { state: 'idle' };
      }
    };
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('approved'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({
          kind: 'spawn',
          agent: { workingDirectory: '/tmp/wt', initialInstructions: 'go' },
          nextState: 'implementing'
        }),
      agent: failingAgent
    });

    await expect(harness.engine.tick({ repo, issueNumber: 24 })).rejects.toThrow(
      'agent failed to start'
    );
    expect(harness.writeState).not.toHaveBeenCalled();
  });
});

describe('createWorkflowEngine tick: policy refuse action', () => {
  it('returns policy-refused with the policy reason and emits only a decision event', async () => {
    const harness = buildHarness({
      readState: vi.fn().mockResolvedValue('triaged'),
      policy: vi
        .fn<(input: PolicyInput) => EngineAction>()
        .mockReturnValue({ kind: 'refuse', reason: 'manual hold' })
    });

    const result = await harness.engine.tick({ repo, issueNumber: 24 });

    expect(result).toEqual({
      issueNumber: 24,
      fromState: 'triaged',
      toState: null,
      action: { kind: 'refuse', reason: 'manual hold' },
      refused: { code: 'policy-refused', reason: 'manual hold' }
    });
    expect(harness.writeState).not.toHaveBeenCalled();
    expect(harness.events).toEqual([
      {
        kind: 'decision',
        at: fixedNow,
        issueNumber: 24,
        fromState: 'triaged',
        action: { kind: 'refuse', reason: 'manual hold' }
      }
    ]);
  });
});
