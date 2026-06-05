import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openEventLog } from '../../src/event-log/store.js';
import { openStateStore } from '../../src/state-store/index.js';
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  EventLogError
} from '../../src/event-log/types.js';

const tempDirs: string[] = [];
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'event-log-append-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('EventLog.append', () => {
  it('persists and returns a record with ISO createdAt', async () => {
    const fixed = new Date('2026-06-05T12:34:56.789Z');
    const log = openEventLog({ path: await tempDb(), now: () => fixed });
    const record = log.append({ eventType: 'agent.created', agentId: 'a-1', issueId: 23 });
    expect(record.id).toBeGreaterThan(0);
    expect(record.eventType).toBe('agent.created');
    expect(record.agentId).toBe('a-1');
    expect(record.issueId).toBe(23);
    expect(record.workflowId).toBeNull();
    expect(record.payload).toEqual({});
    expect(record.schemaVersion).toBe(CURRENT_EVENT_SCHEMA_VERSION);
    expect(record.createdAt).toBe(fixed.toISOString());
    expect(record.createdAt).toMatch(ISO_RE);
    expect(log.list()).toEqual([record]);
    log.close();
  });

  it('rejects unknown event types before insert', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    expect(() => log.append({ eventType: 'bogus.event' as 'agent.created' })).toThrow(EventLogError);
    try {
      log.append({ eventType: 'bogus.event' as 'agent.created' });
    } catch (error) {
      expect(error).toBeInstanceOf(EventLogError);
      expect((error as EventLogError).code).toBe('invalid-event-type');
    }
    log.close();

    const store = openStateStore({ path: dbPath });
    try {
      const count = (store.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c;
      expect(count).toBe(0);
    } finally {
      store.close();
    }
  });

  it('throws closed after close for append and list', async () => {
    const log = openEventLog({ path: await tempDb() });
    log.close();

    try {
      log.append({ eventType: 'agent.created' });
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EventLogError);
      expect((error as EventLogError).code).toBe('closed');
    }

    try {
      log.list();
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EventLogError);
      expect((error as EventLogError).code).toBe('closed');
    }
  });

  it('round-trips custom payload and schemaVersion', async () => {
    const log = openEventLog({ path: await tempDb(), now: () => new Date('2026-06-05T00:00:00.000Z') });
    log.append({
      eventType: 'verification.passed',
      payload: { suite: 'unit', passed: 42 },
      schemaVersion: 99
    });
    const rows = log.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ suite: 'unit', passed: 42 });
    expect(rows[0]?.schemaVersion).toBe(99);
    log.close();
  });
});
