import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

import { registerTimelineCommands, showAction, type TimelineCommandDeps } from '../../src/commands/timeline.js';
import type { EventLog, EventRecord } from '../../src/event-log/types.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

function buildHarness(
  records: EventRecord[],
  overrides: Partial<TimelineCommandDeps> = {}
): { program: Command; io: CapturedIo; list: ReturnType<typeof vi.fn> } {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const list = vi.fn().mockReturnValue(records);
  const deps: TimelineCommandDeps = {
    openEventLog: () =>
      ({
        path: '/tmp/state.db',
        list,
        append: () => records[0]!,
        close: () => {}
      }) satisfies EventLog,
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
  registerTimelineCommands(program, deps);
  return { program, io, list };
}

const activeRecords: EventRecord[] = [
  {
    id: 1,
    eventType: 'plan.approved',
    agentId: null,
    issueId: 31,
    workflowId: null,
    payload: {},
    schemaVersion: 1,
    createdAt: '2026-06-08T10:00:00.000Z'
  }
];

describe('timeline command', () => {
  it('prints text timeline and exits 0 when activity exists', async () => {
    const { program, io } = buildHarness(activeRecords);

    await program.parseAsync(['timeline', 'show', '--issue', '31'], { from: 'user' });

    expect(io.stdout.join('')).toContain('Issue #31');
    expect(io.exitCode).toBe(0);
  });

  it('exits 2 when no mapped activity exists', async () => {
    const { program, io } = buildHarness([]);

    await program.parseAsync(['timeline', 'show', '--issue', '31'], { from: 'user' });

    expect(io.exitCode).toBe(2);
  });

  it('supports --json output', async () => {
    const { program, io } = buildHarness(activeRecords);

    await program.parseAsync(['timeline', 'show', '--issue', '31', '--json'], { from: 'user' });

    expect(JSON.parse(io.stdout.join(''))).toMatchObject({ issueNumber: 31, hasActivity: true });
  });

  it('defaults --limit to 1000', async () => {
    const { program, list } = buildHarness(activeRecords);

    await program.parseAsync(['timeline', 'show', '--issue', '31'], { from: 'user' });

    expect(list).toHaveBeenCalledWith({ issueId: 31, limit: 1000 });
  });

  it('exits 1 when the event log throws', async () => {
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
    await showAction(
      { issue: 31 },
      {
        openEventLog: () => {
          throw new Error('db unavailable');
        },
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('db unavailable');
  });

  it('exits 1 when listing events throws', async () => {
    const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
    await showAction(
      { issue: 31 },
      {
        openEventLog: () => ({
          path: '/tmp/state.db',
          list: () => {
            throw new Error('query failed');
          },
          append: () => activeRecords[0]!,
          close: () => {}
        }),
        write: (channel, message) => {
          io[channel].push(message);
        },
        setExitCode: (code) => {
          io.exitCode = code;
        }
      }
    );

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('query failed');
  });
});
