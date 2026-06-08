import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/store.js';
import { createWorkflowEngine } from '../../src/workflow/engine.js';
import { createWorkflowEventSubscriber } from '../../src/timeline/subscriber.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'timeline-subscriber-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('createWorkflowEventSubscriber', () => {
  it('persists workflow.transition events', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    const subscriber = createWorkflowEventSubscriber(log, { workflowId: 'wf-31' });

    subscriber({
      kind: 'transition',
      at: new Date('2026-06-08T12:00:00.000Z'),
      issueNumber: 31,
      from: 'planned',
      to: 'implementing'
    });

    const records = log.list({ issueId: 31 });
    log.close();

    expect(records).toHaveLength(1);
    expect(records[0]?.eventType).toBe('workflow.transition');
    expect(records[0]?.workflowId).toBe('wf-31');
    expect(records[0]?.payload).toEqual({ from: 'planned', to: 'implementing' });
  });

  it('persists workflow.refused for decision refuse events', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    const subscriber = createWorkflowEventSubscriber(log);

    subscriber({
      kind: 'decision',
      at: new Date('2026-06-08T12:00:00.000Z'),
      issueNumber: 31,
      fromState: 'reviewing',
      action: { kind: 'refuse', reason: 'policy refused' }
    });

    const records = log.list({ issueId: 31 });
    log.close();

    expect(records).toHaveLength(1);
    expect(records[0]?.eventType).toBe('workflow.refused');
    expect(records[0]?.payload).toEqual({
      fromState: 'reviewing',
      code: 'refuse',
      reason: 'policy refused'
    });
  });

  it('ignores non-refuse decision events', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    const subscriber = createWorkflowEventSubscriber(log);

    subscriber({
      kind: 'decision',
      at: new Date('2026-06-08T12:00:00.000Z'),
      issueNumber: 31,
      fromState: 'implementing',
      action: { kind: 'wait' }
    });

    const records = log.list({ issueId: 31 });
    log.close();

    expect(records).toHaveLength(0);
  });

  it('wires into the workflow engine subscriber API', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    const engine = createWorkflowEngine({
      readState: async () => 'planned',
      writeState: async () => {},
      policy: () => ({ kind: 'transition', to: 'approved' })
    });

    engine.on(createWorkflowEventSubscriber(log, { workflowId: 'engine-31' }));
    await engine.tick({ repo: { owner: 'o', repo: 'r' }, issueNumber: 31 });

    const records = log.list({ issueId: 31 });
    log.close();

    expect(records.some((record) => record.eventType === 'workflow.transition')).toBe(true);
  });
});
