import { Command, InvalidArgumentError, Option } from 'commander';

import { openEventLog } from '../event-log/index.js';
import { buildTimeline, renderTimelineJson, renderTimelineText } from '../timeline/index.js';
import type { EventLog } from '../event-log/types.js';

export type WriteChannel = 'stdout' | 'stderr';

export interface TimelineCommandDeps {
  openEventLog: () => EventLog;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: TimelineCommandDeps = {
  openEventLog,
  write: (channel, message) => {
    if (channel === 'stdout') {
      process.stdout.write(message);
    } else {
      process.stderr.write(message);
    }
  },
  setExitCode: (code) => {
    process.exitCode = code;
  }
};

function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}

function parseLimit(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Limit must be a positive integer');
  }
  return parsed;
}

export async function showAction(
  options: { issue: number; json?: boolean; limit?: number },
  deps: TimelineCommandDeps = defaultDeps
): Promise<void> {
  let log: EventLog;
  try {
    log = deps.openEventLog();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(1);
    return;
  }

  try {
    const events = log.list({ issueId: options.issue, limit: options.limit ?? 1000 });
    const timeline = buildTimeline(options.issue, events);
    const output = options.json ? renderTimelineJson(timeline) : renderTimelineText(timeline);
    deps.write('stdout', output);
    deps.setExitCode(timeline.hasActivity ? 0 : 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(1);
  } finally {
    log.close();
  }
}

export function registerTimelineCommands(
  program: Command,
  deps: TimelineCommandDeps = defaultDeps
): Command {
  const timeline = program
    .command('timeline')
    .description('Render workflow timeline for an issue from the event log');

  timeline
    .command('show')
    .description('Show the workflow timeline for the given issue')
    .addOption(
      new Option('--issue <number>', 'Issue number to inspect')
        .argParser(parseIssueNumber)
        .makeOptionMandatory()
    )
    .option('--json', 'Print timeline as JSON')
    .addOption(new Option('--limit <count>', 'Maximum events to load').argParser(parseLimit))
    .action(async (options: { issue: number; json?: boolean; limit?: number }) => {
      await showAction(options, deps);
    });

  return timeline;
}

export { defaultDeps as defaultTimelineCommandDeps };
