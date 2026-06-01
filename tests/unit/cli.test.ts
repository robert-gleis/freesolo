import { describe, expect, it } from 'vitest';

import { buildCli } from '../../src/cli.js';

describe('buildCli', () => {
  it('registers the start command', () => {
    const program = buildCli();

    expect(program.commands.map((command) => command.name())).toContain('start');
    expect(program.name()).toBe('issueflow');
  });

  it('documents the optional worktree setup hook in start help', () => {
    const program = buildCli();
    const startCommand = program.commands.find((command) => command.name() === 'start');
    let helpOutput = '';

    startCommand?.configureOutput({
      writeOut: (value) => {
        helpOutput += value;
      }
    });
    startCommand?.outputHelp();

    expect(helpOutput).toContain('scripts/setup-new-worktree.sh');
    expect(helpOutput).toContain('MAIN_REPO_ROOT');
  });

  it('registers the state command group with get and transition subcommands', () => {
    const program = buildCli();
    const stateCommand = program.commands.find((command) => command.name() === 'state');

    expect(stateCommand).toBeDefined();
    const subcommands = stateCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['get', 'transition']));
  });

  it('registers the engine command group with a tick subcommand', () => {
    const program = buildCli();
    const engineCommand = program.commands.find((command) => command.name() === 'engine');

    expect(engineCommand).toBeDefined();
    const subcommands = engineCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['tick']));
  });
});
