import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { registerReplayCommands, showAction, type ReplayCommandDeps } from '../../src/commands/replay.js';
import { openEventLog } from '../../src/event-log/store.js';
import { buildWorkflowReplay } from '../../src/replay/builder.js';
import { ReplayError } from '../../src/replay/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

const tempDirs: string[] = [];

async function tempDb(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'replay-cmd-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.db');
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function buildHarness(overrides: Partial<ReplayCommandDeps> = {}): {
  program: Command;
  io: CapturedIo;
  deps: ReplayCommandDeps;
} {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: ReplayCommandDeps = {
    buildWorkflowReplay: vi.fn(),
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    },
    ...overrides
  };
  const program = new Command();
  program.exitOverride();
  registerReplayCommands(program, deps);
  return { program, io, deps };
}

describe('replay show command', () => {
  it('exits 0 with replay output', async () => {
    const { io, deps } = buildHarness({
      buildWorkflowReplay: vi.fn().mockReturnValue({
        issueId: 32,
        workflowId: null,
        steps: [],
        startedAt: null,
        endedAt: null
      })
    });

    await showAction({ issue: 32, format: 'text', db: await tempDb() }, deps);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('')).toContain('Issue #32 Session Replay');
  });

  it('exits 2 on no-events', async () => {
    const { io, deps } = buildHarness({
      buildWorkflowReplay: vi.fn().mockImplementation(() => {
        throw new ReplayError('no-events', 'no events found for issue 32');
      })
    });

    await showAction({ issue: 32, format: 'text', db: await tempDb() }, deps);
    expect(io.exitCode).toBe(2);
  });

  it('exits 1 on store-error', async () => {
    const { io, deps } = buildHarness({
      buildWorkflowReplay: vi.fn().mockImplementation(() => {
        throw new ReplayError('store-error', 'db failed');
      })
    });

    await showAction({ issue: 32, format: 'text', db: await tempDb() }, deps);
    expect(io.exitCode).toBe(1);
  });

  it('exits 1 on closed', async () => {
    const { io, deps } = buildHarness({
      buildWorkflowReplay: vi.fn().mockImplementation(() => {
        throw new ReplayError('closed', 'EventLog is closed');
      })
    });

    await showAction({ issue: 32, format: 'text', db: await tempDb() }, deps);
    expect(io.exitCode).toBe(1);
  });

  it('outputs JSON when --format json', async () => {
    const { io, deps } = buildHarness({
      buildWorkflowReplay: vi.fn().mockReturnValue({
        issueId: 32,
        workflowId: 'wf',
        steps: [],
        startedAt: null,
        endedAt: null
      })
    });

    await showAction({ issue: 32, format: 'json', db: await tempDb() }, deps);
    expect(JSON.parse(io.stdout.join(''))).toMatchObject({ issueId: 32 });
  });

  it('reads from --db path', async () => {
    const dbPath = await tempDb();
    const log = openEventLog({ path: dbPath });
    log.append({
      eventType: 'agent.created',
      issueId: 32,
      agentId: 'a',
      payload: {}
    });
    log.close();

    const { io, deps } = buildHarness({ buildWorkflowReplay });
    await showAction({ issue: 32, format: 'text', db: dbPath }, deps);
    expect(io.exitCode).toBe(0);
    expect(io.stdout.join('')).toContain('agent.created');
  });
});
