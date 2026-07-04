import { Command } from 'commander';

import {
  buildWorkflowReplay,
  formatReplayJson,
  formatReplayText,
  ReplayError
} from '../replay/index.js';
import { openAgentLogStore } from '../replay/log-store.js';
import { openEventLog } from '../event-log/store.js';
import { defaultSetExitCode, defaultWrite, parseIssueNumber, type WriteChannel } from './shared.js';

export interface ReplayCommandDeps {
  buildWorkflowReplay: typeof buildWorkflowReplay;
  write: (channel: WriteChannel, message: string) => void;
  setExitCode: (code: number) => void;
}

const defaultDeps: ReplayCommandDeps = {
  buildWorkflowReplay,
  write: defaultWrite,
  setExitCode: defaultSetExitCode
};

export async function showAction(
  options: { issue: number; format?: string; db?: string },
  deps: ReplayCommandDeps = defaultDeps
): Promise<void> {
  const format = options.format ?? 'text';
  if (format !== 'text' && format !== 'json') {
    deps.setExitCode(2);
    deps.write('stderr', `Unsupported format "${format}". Use text or json.\n`);
    return;
  }

  let eventLog;
  let logStore;
  try {
    eventLog = openEventLog(options.db ? { path: options.db } : {});
    logStore = openAgentLogStore({ path: eventLog.path });
    const replay = deps.buildWorkflowReplay({
      issueId: options.issue,
      eventLog,
      logStore
    });
    const output = format === 'json' ? formatReplayJson(replay) : formatReplayText(replay);
    deps.write('stdout', `${output}\n`);
    deps.setExitCode(0);
  } catch (error) {
    if (error instanceof ReplayError) {
      if (error.code === 'no-events') {
        deps.write('stderr', `${error.message}\n`);
        deps.setExitCode(2);
        return;
      }
      deps.write('stderr', `${error.message}\n`);
      deps.setExitCode(1);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    deps.write('stderr', `${message}\n`);
    deps.setExitCode(1);
  } finally {
    logStore?.close();
    eventLog?.close();
  }
}

export function registerReplayCommands(program: Command, deps: ReplayCommandDeps = defaultDeps): void {
  const replay = program.command('replay').description('Inspect completed workflow sessions');

  replay
    .command('show')
    .description('Show a replay for one issue from persisted telemetry')
    .requiredOption('--issue <number>', 'Issue number', parseIssueNumber)
    .option('--format <format>', 'Output format: text or json', 'text')
    .option('--db <path>', 'Override path to state.db')
    .action((options) => showAction(options, deps));
}
