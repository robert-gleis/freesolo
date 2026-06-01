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

  it('registers the verify command with the expected options', () => {
    const program = buildCli();
    const verify = program.commands.find((command) => command.name() === 'verify');

    expect(verify).toBeDefined();
    const optionFlags = verify?.options.map((option) => option.long) ?? [];
    expect(optionFlags).toContain('--issue');
    expect(optionFlags).toContain('--config');
    expect(optionFlags).toContain('--print-only');
    expect(optionFlags).toContain('--bail');
  });

  it('rejects non-integer --issue values', () => {
    const program = buildCli();
    const verify = program.commands.find((command) => command.name() === 'verify');
    expect(verify).toBeDefined();

    // commander throws CommanderError on InvalidArgumentError when exitOverride is set
    verify?.exitOverride();
    expect(() => verify?.parse(['--issue', '1abc'], { from: 'user' })).toThrow(/positive integer/);
  });
});
