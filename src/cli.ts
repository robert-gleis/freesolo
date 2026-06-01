import { Command, Option } from 'commander';

import { startAction } from './commands/start.js';
import { registerEngineCommands } from './commands/engine.js';
import { registerStateCommands } from './commands/state.js';

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

  registerStateCommands(program);
  registerEngineCommands(program);

  return program;
}
