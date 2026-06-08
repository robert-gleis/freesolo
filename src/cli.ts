import { Command, InvalidArgumentError, Option } from 'commander';

import { registerCandidateCommands } from './commands/candidate.js';
import { registerConfigCommands } from './commands/config.js';
import { registerDecompositionCommands } from './commands/decomposition.js';
import { registerEngineCommands } from './commands/engine.js';
import { registerGateCommands } from './commands/gate.js';
import { registerMergeCommands } from './commands/merge.js';
import { registerPlanCommands } from './commands/plan.js';
import { registerPrCommands } from './commands/pr.js';
import { registerReplayCommands } from './commands/replay.js';
import { registerReportsCommands } from './commands/reports.js';
import { registerTeamCommands } from './commands/team.js';
import { registerStateCommands } from './commands/state.js';
import { startAction } from './commands/start.js';
import { registerTimelineCommands } from './commands/timeline.js';
import { registerWatchCommands } from './commands/watch.js';
import { registerWorktreesCommands } from './commands/worktrees.js';
import { verifyAction } from './commands/verify.js';

export function buildCli(): Command {
  const program = new Command();

  program
    .name('issueflow')
    .description('Start focused issue sessions from the current repository');

  program
    .command('start')
    .description('Start or resume work for one assigned issue')
    .addOption(
      new Option('--tool <tool>', 'Host tool to launch')
        .choices(['codex', 'claude', 'cursor'])
        .makeOptionMandatory()
    )
    .option('--print-only', 'Print the derived actions without launching the host')
    .addHelpText(
      'after',
      `

Worktree setup:
  After creating or attaching a worktree, issueflow runs scripts/setup-new-worktree.sh
  from that worktree when it exists. The hook receives MAIN_REPO_ROOT pointing at
  the source checkout. Existing reused worktrees skip this hook.`
    )
    .action(startAction);

  program
    .command('verify')
    .description('Run the verification pipeline against the current repo state')
    .option('--issue <number>', 'Issue id to associate this run with', (value) => {
      if (!/^\d+$/.test(value)) {
        throw new InvalidArgumentError(`--issue must be a positive integer (got "${value}").`);
      }
      return Number.parseInt(value, 10);
    })
    .option('--config <path>', 'Path to the verification config file')
    .option('--print-only', 'Print the resolved plan without spawning checks')
    .option('--bail', 'Stop the pipeline after the first failing check')
    .action(verifyAction);

  registerStateCommands(program);
  registerEngineCommands(program);
  registerGateCommands(program);
  registerPrCommands(program);
  registerMergeCommands(program);
  registerPlanCommands(program);
  registerDecompositionCommands(program);
  registerTeamCommands(program);
  registerWatchCommands(program);
  registerWorktreesCommands(program);
  registerCandidateCommands(program);
  registerReportsCommands(program);
  registerTimelineCommands(program);
  registerReplayCommands(program);
  registerConfigCommands(program);

  return program;
}
