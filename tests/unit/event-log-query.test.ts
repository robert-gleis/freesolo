import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/store.js';

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-log-query-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('EventLog.list', () => {
  it('filters by eventType, issueId, agentId, and workflowId', async () => {
    const log = openEventLog({
      path: await tempDb(),
      now: () => new Date('2026-06-05T00:00:00.000Z')
    });

    log.append({ eventType: 'agent.created', agentId: 'agent-1', issueId: 23 });
    log.append({ eventType: 'agent.stopped', agentId: 'agent-1', issueId: 23 });
    log.append({ eventType: 'issue.assigned', agentId: 'agent-2', issueId: 42, workflowId: 'wf-a' });
    log.append({ eventType: 'issue.assigned', agentId: 'agent-2', issueId: 42, workflowId: 'wf-b' });
    log.append({ eventType: 'plan.approved', issueId: 23 });

    expect(log.list({ eventType: 'agent.created' })).toHaveLength(1);
    expect(log.list({ issueId: 23 })).toHaveLength(3);
    expect(log.list({ agentId: 'agent-1' })).toHaveLength(2);
    expect(log.list({ workflowId: 'wf-a' })).toHaveLength(1);
    expect(log.list({ workflowId: 'wf-a' })[0]?.workflowId).toBe('wf-a');

    log.close();
  });

  it('returns newest rows first and respects default and max limits', async () => {
    const log = openEventLog({
      path: await tempDb(),
      now: () => new Date('2026-06-05T00:00:00.000Z')
    });

    for (let i = 0; i < 5; i++) {
      log.append({ eventType: 'agent.created', payload: { i } });
    }

    const limited = log.list({ limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited[0]?.id).toBeGreaterThan(limited[1]?.id ?? 0);
    expect(limited[0]?.payload).toEqual({ i: 4 });

    for (let i = 5; i < 1105; i++) {
      log.append({ eventType: 'agent.created', payload: { i } });
    }

    expect(log.list()).toHaveLength(100);
    expect(log.list({ limit: 9999 })).toHaveLength(1000);

    log.close();
  });

  it('combines filters with AND semantics', async () => {
    const log = openEventLog({
      path: await tempDb(),
      now: () => new Date('2026-06-05T00:00:00.000Z')
    });

    log.append({ eventType: 'agent.created', agentId: 'a', issueId: 1 });
    log.append({ eventType: 'agent.created', agentId: 'b', issueId: 1 });
    log.append({ eventType: 'agent.stopped', agentId: 'a', issueId: 1 });

    expect(log.list({ eventType: 'agent.created', issueId: 1, agentId: 'a' })).toHaveLength(1);

    log.close();
  });

  it('lists events in ascending id order when order is asc', async () => {
    const log = openEventLog({
      path: await tempDb(),
      now: () => new Date('2026-06-05T00:00:00.000Z')
    });

    log.append({ eventType: 'agent.created', agentId: 'a' });
    log.append({ eventType: 'agent.stopped', agentId: 'a' });
    const ids = log.list({ order: 'asc' }).map((r) => r.id);
    expect(ids[0]).toBeLessThan(ids[1]!);

    log.close();
  });
});
