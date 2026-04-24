import { describe, expect, it } from 'vitest';

import { buildCli } from '../../src/cli.js';

describe('buildCli', () => {
  it('registers the start command', () => {
    const program = buildCli();

    expect(program.commands.map((command) => command.name())).toContain('start');
    expect(program.name()).toBe('issueflow');
  });
});
