import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/store.js';
import { buildWorkflowReplay } from '../../src/replay/builder.js';
import { openAgentLogStore } from '../../src/replay/log-store.js';
import { captureAgentLogSnapshot } from '../../src/replay/persistence.js';
import { ReplayError } from '../../src/replay/types.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-builder-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('buildWorkflowReplay', () => {
  it('throws no-events when issue has no telemetry', async () => {
    const dbPath = await tempDb();
    const eventLog = openEventLog({ path: dbPath });
    const logStore = openAgentLogStore({ path: dbPath });

    expect(() => buildWorkflowReplay({ issueId: 32, eventLog, logStore })).toThrow(ReplayError);
    try {
      buildWorkflowReplay({ issueId: 32, eventLog, logStore });
    } catch (error) {
      expect((error as ReplayError).code).toBe('no-events');
    }

    eventLog.close();
    logStore.close();
  });

  it('throws closed when event log is closed', async () => {
    const dbPath = await tempDb();
    const eventLog = openEventLog({ path: dbPath });
    const logStore = openAgentLogStore({ path: dbPath });
    eventLog.close();

    expect(() => buildWorkflowReplay({ issueId: 32, eventLog, logStore })).toThrow(ReplayError);
    try {
      buildWorkflowReplay({ issueId: 32, eventLog, logStore });
    } catch (error) {
      expect((error as ReplayError).code).toBe('closed');
    }

    logStore.close();
  });

  it('throws store-error when log snapshot is missing', async () => {
    const dbPath = await tempDb();
    const eventLog = openEventLog({ path: dbPath });
    const logStore = openAgentLogStore({ path: dbPath });

    eventLog.append({
      eventType: 'agent.log.captured',
      issueId: 32,
      agentId: 'a',
      workflowId: 'wf-32',
      payload: { snapshotId: 999 }
    });

    expect(() => buildWorkflowReplay({ issueId: 32, eventLog, logStore })).toThrow(ReplayError);
    try {
      buildWorkflowReplay({ issueId: 32, eventLog, logStore });
    } catch (error) {
      expect((error as ReplayError).code).toBe('store-error');
    }

    eventLog.close();
    logStore.close();
  });

  it('assembles chronological replay with lifecycle and hydrated logs', async () => {
    const dbPath = await tempDb();
    const eventLog = openEventLog({ path: dbPath });
    const logStore = openAgentLogStore({ path: dbPath });

    eventLog.append({
      eventType: 'workflow.decision',
      issueId: 32,
      workflowId: 'wf-32',
      payload: { fromState: 'planned', action: { kind: 'wait', reason: 'working' } }
    });
    eventLog.append({
      eventType: 'workflow.transition',
      issueId: 32,
      workflowId: 'wf-32',
      payload: { from: 'planned', to: 'implemented' }
    });
    eventLog.append({
      eventType: 'agent.created',
      issueId: 32,
      agentId: 'agent-1',
      workflowId: 'wf-32',
      payload: { host: 'cursor' }
    });
    eventLog.append({
      eventType: 'agent.stopped',
      issueId: 32,
      agentId: 'agent-1',
      workflowId: 'wf-32',
      payload: {}
    });
    captureAgentLogSnapshot({
      agentId: 'agent-1',
      issueId: 32,
      workflowId: 'wf-32',
      snapshot: { stdout: 'done', stderr: '', combined: 'done', truncated: false },
      eventLog,
      logStore
    });
    eventLog.append({ eventType: 'plan.approved', issueId: 32, workflowId: 'wf-32', payload: {} });

    const replay = buildWorkflowReplay({ issueId: 32, eventLog, logStore });

    expect(replay.workflowId).toBe('wf-32');
    expect(replay.steps).toHaveLength(5);
    expect(replay.steps.map((s) => s.kind)).toEqual([
      'workflow.decision',
      'workflow.transition',
      'agent.lifecycle',
      'agent.lifecycle',
      'agent.log'
    ]);
    expect(replay.steps[2]).toMatchObject({ eventType: 'agent.created', agentId: 'agent-1' });
    expect(replay.steps[3]).toMatchObject({ eventType: 'agent.stopped', agentId: 'agent-1' });
    expect(replay.steps[4]).toMatchObject({ kind: 'agent.log', stdout: 'done' });
    expect(replay.startedAt).toBeTruthy();
    expect(replay.endedAt).toBeTruthy();

    eventLog.close();
    logStore.close();
  });

  it('throws no-events when only non-replayable events exist', async () => {
    const dbPath = await tempDb();
    const eventLog = openEventLog({ path: dbPath });
    const logStore = openAgentLogStore({ path: dbPath });

    eventLog.append({ eventType: 'plan.approved', issueId: 32, payload: {} });

    expect(() => buildWorkflowReplay({ issueId: 32, eventLog, logStore })).toThrow(ReplayError);
    try {
      buildWorkflowReplay({ issueId: 32, eventLog, logStore });
    } catch (error) {
      expect((error as ReplayError).code).toBe('no-events');
    }

    eventLog.close();
    logStore.close();
  });
});
