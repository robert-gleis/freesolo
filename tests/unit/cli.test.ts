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
});
