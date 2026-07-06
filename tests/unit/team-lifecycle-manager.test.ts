import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { describe, expect, it } from 'vitest';

import type {
  AgentAdapter,
  AgentResponse,
  AgentStartInput,
  AgentState,
  AgentStatus
} from '../../src/agents/types.js';
import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import type { AppendEventInput, EventLog, EventRecord } from '../../src/event-log/types.js';
import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';
import {
  TeamLifecycleError,
  TeamLifecycleManager,
  type AgentAdapterFactory
} from '../../src/teams/index.js';
import { readTeamRuntimeSnapshot } from '../../src/teams/store.js';

const definition: TeamDefinition = {
  roles: [{ name: 'Engineer', host: 'cursor', responsibility: 'Ship feature', count: 1 }]
};

class StoppableAdapter implements AgentAdapter {
  private state: AgentState = 'idle';

  async start(_input: AgentStartInput): Promise<void> {
    this.state = 'running';
  }

  async stop(): Promise<void> {
    this.state = 'stopped';
  }

  async send(_input: string): Promise<AgentResponse> {
    return { output: 'ok' };
  }

  async status(): Promise<AgentStatus> {
    return { state: this.state };
  }
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-team-manager-'));
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function createEventLog(): EventLog & { events: AppendEventInput[] } {
  const events: AppendEventInput[] = [];
  let id = 0;
  return {
    path: '/tmp/state.db',
    events,
    append(input) {
      events.push(input);
      id += 1;
      return {
        id,
        eventType: input.eventType,
        agentId: input.agentId ?? null,
        issueId: input.issueId ?? null,
        workflowId: input.workflowId ?? null,
        payload: input.payload ?? {},
        schemaVersion: 1,
        createdAt: new Date().toISOString()
      } satisfies EventRecord;
    },
    list: () => [],
    close: () => {}
  };
}

function buildManager(
  worktreePath: string,
  options: {
    adapterFactory?: AgentAdapterFactory;
    config?: { pollIntervalMs?: number; memberBlockedTimeoutMs?: number; teamTimeoutMs?: number };
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
  } = {}
) {
  const eventLog = createEventLog();
  const manager = new TeamLifecycleManager({
    worktreePath,
    issueNumber: 41,
    eventLog,
    adapterFactory:
      options.adapterFactory ??
      ({
        create: () =>
          new ScriptedAgentAdapter({
            steps: [{ match: /.*/, output: 'ok' }]
          })
      } satisfies AgentAdapterFactory),
    config: options.config,
    now: options.now,
    sleep: options.sleep
  });
  return { manager, eventLog };
}

describe('TeamLifecycleManager.create', () => {
  it('starts members and emits lifecycle events', async () => {
    const worktreePath = await makeRepo();
    const { manager, eventLog } = buildManager(worktreePath);

    await manager.create(definition);

    expect(manager.status().phase).toBe('running');
    expect(eventLog.events.map((event) => event.eventType)).toEqual(['agent.created', 'team.created']);
    expect(await readTeamRuntimeSnapshot(worktreePath)).toMatchObject({ phase: 'running' });
  });

  it('continues when one member fails to start', async () => {
    const worktreePath = await makeRepo();
    let call = 0;
    const { manager, eventLog } = buildManager(worktreePath, {
      adapterFactory: {
        create: () => {
          call += 1;
          if (call === 1) {
            return {
              start: async () => {
                throw new Error('boom');
              },
              stop: async () => {},
              send: async () => ({ output: '' }),
              status: async (): Promise<AgentStatus> => ({ state: 'error', error: 'start-failed' })
            };
          }
          return new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'ok' }] });
        }
      }
    });

    await manager.create({
      roles: [
        { name: 'A', host: 'cursor', responsibility: 'one', count: 1 },
        { name: 'B', host: 'cursor', responsibility: 'two', count: 1 }
      ]
    });

    expect(manager.status().phase).toBe('running');
    expect(eventLog.events.some((event) => event.eventType === 'agent.stopped')).toBe(true);
  });

  it('stops with error when all members fail to start', async () => {
    const worktreePath = await makeRepo();
    const { manager, eventLog } = buildManager(worktreePath, {
      adapterFactory: {
        create: () => ({
          start: async () => {
            throw new Error('boom');
          },
          stop: async () => {},
          send: async () => ({ output: '' }),
          status: async (): Promise<AgentStatus> => ({ state: 'error' })
        })
      }
    });

    await manager.create(definition);

    expect(manager.status().phase).toBe('stopped');
    expect(manager.status().stopReason).toBe('error');
    expect(eventLog.events.some((event) => event.eventType === 'team.created')).toBe(false);
  });
});

describe('TeamLifecycleManager.monitor', () => {
  it('completes when all members stop', async () => {
    const worktreePath = await makeRepo();
    const adapters: StoppableAdapter[] = [];
    const { manager } = buildManager(worktreePath, {
      adapterFactory: {
        create: () => {
          const adapter = new StoppableAdapter();
          adapters.push(adapter);
          return adapter;
        }
      },
      config: { pollIntervalMs: 1, memberBlockedTimeoutMs: 60_000 },
      sleep: async () => {
        await Promise.all(adapters.map((adapter) => adapter.stop()));
      }
    });

    await manager.create(definition);
    const reason = await manager.monitor();
    expect(reason).toBe('completed');
    expect(manager.status().phase).toBe('stopped');
  });

  it('rejects concurrent monitor calls', async () => {
    const worktreePath = await makeRepo();
    let unblock: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const { manager } = buildManager(worktreePath, {
      config: { pollIntervalMs: 1, memberBlockedTimeoutMs: 60_000 },
      sleep: async () => {
        await gate;
      }
    });
    await manager.create(definition);

    const first = manager.monitor();
    await expect(manager.monitor()).rejects.toMatchObject({
      name: 'TeamLifecycleError',
      code: 'invalid-state'
    });
    unblock?.();
    await manager.tearDown('cancelled');
    await first.catch(() => undefined);
  });

  it('stops with error when all members are in error', async () => {
    const worktreePath = await makeRepo();
    const { manager } = buildManager(worktreePath, {
      adapterFactory: {
        create: () => ({
          start: async () => {},
          stop: async () => {},
          send: async () => ({ output: 'ok' }),
          status: async (): Promise<AgentStatus> => ({ state: 'error', error: 'boom' })
        })
      },
      config: { pollIntervalMs: 1, memberBlockedTimeoutMs: 60_000 },
      sleep: async () => {}
    });

    await manager.create(definition);
    const reason = await manager.monitor();
    expect(reason).toBe('error');
  });

  it('times out on inactivity', async () => {
    const worktreePath = await makeRepo();
    const base = Date.now();
    let tick = 0;
    const { manager } = buildManager(worktreePath, {
      adapterFactory: {
        create: () => ({
          start: async (_input: AgentStartInput) => {},
          stop: async () => {},
          send: async (_input: string): Promise<AgentResponse> => ({ output: 'ok' }),
          status: async (): Promise<AgentStatus> => ({
            state: 'running',
            startedAt: new Date(base - 120_000),
            lastActivityAt: new Date(base - 120_000)
          })
        })
      },
      config: { pollIntervalMs: 1, memberBlockedTimeoutMs: 1_000 },
      now: () => {
        tick += 1;
        return new Date(base + tick * 2_000);
      },
      sleep: async () => {}
    });

    await manager.create(definition);
    const reason = await manager.monitor();
    expect(reason).toBe('timeout');
  });
});

describe('TeamLifecycleManager.tearDown', () => {
  it('cancels a running team', async () => {
    const worktreePath = await makeRepo();
    const { manager, eventLog } = buildManager(worktreePath);
    await manager.create(definition);
    const reason = await manager.tearDown('cancelled');
    expect(reason).toBe('cancelled');
    expect(manager.status().phase).toBe('stopped');
    expect(eventLog.events.some((event) => event.eventType === 'team.torn-down')).toBe(true);
  });

  it('rejects create when not idle', async () => {
    const worktreePath = await makeRepo();
    const { manager } = buildManager(worktreePath);
    await manager.create(definition);
    await expect(manager.create(definition)).rejects.toBeInstanceOf(TeamLifecycleError);
  });
});
