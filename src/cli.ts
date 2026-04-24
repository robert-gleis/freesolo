import { Command, Option } from 'commander';

import { startAction } from './commands/start.js';

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
    .action(startAction);

  return program;
}
