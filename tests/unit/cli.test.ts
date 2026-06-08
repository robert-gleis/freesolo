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

    verify?.exitOverride();
    expect(() => verify?.parse(['--issue', '1abc'], { from: 'user' })).toThrow(/positive integer/);
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

  it('registers the gate command group with an evaluate subcommand and optional --issue', () => {
    const program = buildCli();
    const gateCommand = program.commands.find((command) => command.name() === 'gate');

    expect(gateCommand).toBeDefined();
    const subcommands = gateCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toContain('evaluate');

    const evaluateCmd = gateCommand?.commands.find((command) => command.name() === 'evaluate');
    const optionFlags = evaluateCmd?.options.map((option) => option.long) ?? [];
    expect(optionFlags).toContain('--issue');

    const issueOpt = evaluateCmd?.options.find((option) => option.long === '--issue');
    expect(issueOpt?.mandatory).toBeFalsy();
  });

  it('registers the pr command group with a create subcommand having --print-only and optional --issue', () => {
    const program = buildCli();
    const prCommand = program.commands.find((command) => command.name() === 'pr');

    expect(prCommand).toBeDefined();
    const subcommands = prCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toContain('create');

    const createCmd = prCommand?.commands.find((command) => command.name() === 'create');
    const optionFlags = createCmd?.options.map((option) => option.long) ?? [];
    expect(optionFlags).toContain('--print-only');
    expect(optionFlags).toContain('--issue');

    const issueOpt = createCmd?.options.find((option) => option.long === '--issue');
    expect(issueOpt?.mandatory).toBeFalsy();
  });

  it('registers the plan command group with generate, show, edit, and approve subcommands', () => {
    const program = buildCli();
    const planCommand = program.commands.find((command) => command.name() === 'plan');

    expect(planCommand).toBeDefined();
    const subcommands = planCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['generate', 'show', 'edit', 'approve']));
  });

  it('registers the team command group with start, status, and stop subcommands', () => {
    const program = buildCli();
    const teamCommand = program.commands.find((command) => command.name() === 'team');

    expect(teamCommand).toBeDefined();
    const subcommands = teamCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['start', 'status', 'stop']));
  });

  it('registers the watch command group with run and once subcommands', () => {
    const program = buildCli();
    const watchCommand = program.commands.find((command) => command.name() === 'watch');

    expect(watchCommand).toBeDefined();
    const subcommands = watchCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['run', 'once']));
  });

  it('registers the worktrees command group with list and drift subcommands', () => {
    const program = buildCli();
    const worktreesCommand = program.commands.find((command) => command.name() === 'worktrees');

    expect(worktreesCommand).toBeDefined();
    const subcommands = worktreesCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['list', 'drift']));
  });

  it('registers the candidate command group with create and show subcommands', () => {
    const program = buildCli();
    const candidateCommand = program.commands.find((command) => command.name() === 'candidate');

    expect(candidateCommand).toBeDefined();
    const subcommands = candidateCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['create', 'show']));
  });

  it('registers the timeline command group with show subcommand and flags', () => {
    const program = buildCli();
    const timelineCommand = program.commands.find((command) => command.name() === 'timeline');

    expect(timelineCommand).toBeDefined();
    const subcommands = timelineCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['show']));

    const showCommand = timelineCommand?.commands.find((command) => command.name() === 'show');
    const optionFlags = showCommand?.options.map((option) => option.long) ?? [];
    expect(optionFlags).toEqual(expect.arrayContaining(['--issue', '--json', '--limit']));
  });

  it('rejects non-integer timeline --issue values', () => {
    const program = buildCli();
    const timelineCommand = program.commands.find((command) => command.name() === 'timeline');
    const showCommand = timelineCommand?.commands.find((command) => command.name() === 'show');
    expect(showCommand).toBeDefined();

    showCommand?.exitOverride();
    expect(() => showCommand?.parse(['--issue', '31abc'], { from: 'user' })).toThrow(/positive integer/);
  });

  it('registers the replay command group with show subcommand', () => {
    const program = buildCli();
    const replayCommand = program.commands.find((command) => command.name() === 'replay');

    expect(replayCommand).toBeDefined();
    const subcommands = replayCommand?.commands.map((command) => command.name()) ?? [];
    expect(subcommands).toEqual(expect.arrayContaining(['show']));
  });
});
