import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/store.js';
import { openAgentLogStore } from '../../src/replay/log-store.js';
import { captureAgentLogSnapshot, persistWorkflowEngineEvents } from '../../src/replay/persistence.js';
import { createWorkflowEngine } from '../../src/workflow/engine.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-persist-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('persistWorkflowEngineEvents', () => {
  it('persists workflow decisions and transitions', async () => {
    const eventLog = openEventLog({ path: await tempDb() });
    const engine = createWorkflowEngine({
      readState: async () => 'planned',
      writeState: async () => {},
      policy: () => ({ kind: 'transition', to: 'implemented' })
    });

    const unsubscribe = persistWorkflowEngineEvents(engine, {
      issueId: 32,
      workflowId: 'wf-32',
      eventLog
    });

    await engine.tick({ repo: { owner: 'o', repo: 'r' }, issueNumber: 32 });

    const events = eventLog.list({ issueId: 32, order: 'asc' });
    expect(events.some((e) => e.eventType === 'workflow.decision')).toBe(true);
    expect(events.some((e) => e.eventType === 'workflow.transition')).toBe(true);

    unsubscribe();
    await engine.tick({ repo: { owner: 'o', repo: 'r' }, issueNumber: 32 });
    const after = eventLog.list({ issueId: 32, order: 'asc' });
    expect(after.filter((e) => e.eventType.startsWith('workflow.'))).toHaveLength(2);

    eventLog.close();
  });
});

describe('captureAgentLogSnapshot', () => {
  it('stores snapshot and appends agent.log.captured event', async () => {
    const dbPath = await tempDb();
    const eventLog = openEventLog({ path: dbPath });
    const logStore = openAgentLogStore({ path: dbPath });

    captureAgentLogSnapshot({
      agentId: 'agent-1',
      issueId: 32,
      workflowId: 'wf-32',
      snapshot: { stdout: 'out', stderr: 'err', combined: 'out\nerr', truncated: false },
      eventLog,
      logStore
    });

    const events = eventLog.list({ issueId: 32, order: 'asc' });
    const captured = events.find((e) => e.eventType === 'agent.log.captured');
    expect(captured).toBeDefined();
    expect(captured?.payload.snapshotId).toBeTypeOf('number');

    eventLog.close();
    logStore.close();
  });
});
