import { afterEach, describe, expect, it, vi } from 'vitest';

import { Command } from 'commander';

import {
  registerEngineCommands,
  type EngineCommandDeps
} from '../../src/commands/engine.js';
import type { TickResult } from '../../src/workflow/engine.js';

interface CapturedIo {
  stdout: string[];
  stderr: string[];
  exitCode: number | null;
}

interface Harness {
  program: Command;
  io: CapturedIo;
  deps: EngineCommandDeps;
}

function tickResult(overrides: Partial<TickResult> = {}): TickResult {
  return {
    issueNumber: 24,
    fromState: 'implementing',
    toState: 'implementing',
    action: { kind: 'wait', reason: 'agent owns implementation' },
    ...overrides
  };
}

function buildHarness(overrides: Partial<EngineCommandDeps> = {}): Harness {
  const io: CapturedIo = { stdout: [], stderr: [], exitCode: null };
  const deps: EngineCommandDeps = {
    resolveRepoRef: vi.fn().mockResolvedValue({ owner: 'acme', repo: 'widgets' }),
    tick: vi.fn().mockResolvedValue(tickResult()),
    env: { ISSUEFLOW_ENGINE: '1' },
    write: (channel, message) => {
      io[channel].push(message);
    },
    setExitCode: (code) => {
      io.exitCode = code;
    },
    ...overrides
  };
  const program = new Command();
  program.exitOverride();
  registerEngineCommands(program, deps);
  return { program, io, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('issueflow engine tick gating', () => {
  it('refuses to run without ISSUEFLOW_ENGINE=1 and exits 3', async () => {
    const { program, io, deps } = buildHarness({ env: {} });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(deps.tick).not.toHaveBeenCalled();
    expect(io.exitCode).toBe(3);
    expect(io.stderr.join('')).toContain('ISSUEFLOW_ENGINE');
  });
});

describe('issueflow engine tick happy paths', () => {
  it('prints the wait summary on stdout and exits 0', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'implementing',
          toState: 'implementing',
          action: { kind: 'wait', reason: 'agent owns implementation' }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.stdout.join('')).toBe('implementing (wait: agent owns implementation)\n');
    expect(io.exitCode).toBeNull();
  });

  it('prints the transition summary on stdout and exits 0', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'merged',
          toState: 'closed',
          action: { kind: 'transition', to: 'closed' }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.stdout.join('')).toBe('merged -> closed (transition)\n');
    expect(io.exitCode).toBeNull();
  });

  it('prints the spawn summary on stdout and exits 0', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'approved',
          toState: 'implementing',
          action: {
            kind: 'spawn',
            agent: { workingDirectory: '/tmp/wt', initialInstructions: 'continue issueflow' },
            nextState: 'implementing'
          }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.stdout.join('')).toBe('approved -> implementing (spawn -> implementing)\n');
    expect(io.exitCode).toBeNull();
  });
});

describe('issueflow engine tick refusal exit codes', () => {
  it('exits 2 for no-state refusals', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: null,
          toState: null,
          action: { kind: 'refuse', reason: 'issue has no state label' },
          refused: { code: 'no-state', reason: 'issue has no state label' }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('no-state');
  });

  it('exits 2 for terminal-state refusals', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'closed',
          toState: null,
          action: { kind: 'refuse', reason: 'issue is in terminal state "closed"' },
          refused: { code: 'terminal-state', reason: 'issue is in terminal state "closed"' }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('terminal-state');
  });

  it('exits 2 for policy-refused refusals', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'triaged',
          toState: null,
          action: { kind: 'refuse', reason: 'manual hold' },
          refused: { code: 'policy-refused', reason: 'manual hold' }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(2);
    expect(io.stderr.join('')).toContain('policy-refused');
  });

  it('exits 1 for invalid-transition refusals', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'triaged',
          toState: null,
          action: { kind: 'transition', to: 'closed' },
          refused: {
            code: 'invalid-transition',
            reason: 'Invalid workflow transition: triaged → closed. Allowed from triaged: planned.'
          }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('Invalid workflow transition');
  });

  it('exits 1 for no-agent-adapter refusals', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: 'approved',
          toState: null,
          action: {
            kind: 'spawn',
            agent: { workingDirectory: '/tmp/wt', initialInstructions: 'go' },
            nextState: 'implementing'
          },
          refused: {
            code: 'no-agent-adapter',
            reason: 'policy returned a spawn action but no agent adapter is configured'
          }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('no-agent-adapter');
  });

  it('exits 4 for malformed-state refusals', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockResolvedValue(
        tickResult({
          fromState: null,
          toState: null,
          action: { kind: 'refuse', reason: 'malformed' },
          refused: {
            code: 'malformed-state',
            reason:
              'Issue #24 has multiple workflow state labels: triaged, planned. Repair manually before retrying.'
          }
        })
      )
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(4);
    expect(io.stderr.join('')).toContain('multiple workflow state labels');
  });
});

describe('issueflow engine tick error wrapping', () => {
  it('catches unexpected throws from resolveRepoRef and exits 1 with a clean stderr message', async () => {
    const { program, io } = buildHarness({
      resolveRepoRef: vi
        .fn()
        .mockRejectedValue(new Error('issueflow must be started inside a git repository'))
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('issueflow must be started inside a git repository');
  });

  it('catches unexpected throws from tick (e.g. agent adapter errors) and exits 1', async () => {
    const { program, io } = buildHarness({
      tick: vi.fn().mockRejectedValue(new Error('agent failed to start'))
    });

    await program.parseAsync(['node', 'issueflow', 'engine', 'tick', '--issue', '24']);

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join('')).toContain('agent failed to start');
  });
});
