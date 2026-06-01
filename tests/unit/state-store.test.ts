import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import {
  defaultRunner,
  ensureStateLabels,
  InvalidStateLabelError,
  MultipleStateLabelsError,
  readState,
  STATE_LABEL_PREFIX,
  writeState,
  type GhRunner
} from '../../src/workflow/state-store.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
const { execa } = await import('execa');

beforeEach(() => {
  vi.mocked(execa).mockReset();
});

interface Call {
  args: string[];
}

interface ScriptedReply {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function buildRunner(reply: (call: Call) => ScriptedReply | Promise<ScriptedReply>): {
  runner: GhRunner;
  calls: Call[];
} {
  const calls: Call[] = [];
  const runner: GhRunner = async (args) => {
    const call = { args };
    calls.push(call);
    const result = await reply(call);
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0
    };
  };
  return { runner, calls };
}

const repo = { owner: 'acme', repo: 'widgets' };

describe('readState', () => {
  it('returns null when no state:* label is present', async () => {
    const { runner } = buildRunner(() => ({
      stdout: JSON.stringify({ labels: [{ name: 'bug' }, { name: 'priority-1' }] })
    }));

    expect(await readState(repo, 42, { gh: runner })).toBeNull();
  });

  it('returns the canonical state when exactly one state:* label is present', async () => {
    const { runner, calls } = buildRunner(() => ({
      stdout: JSON.stringify({ labels: [{ name: 'bug' }, { name: 'state:implementing' }] })
    }));

    expect(await readState(repo, 42, { gh: runner })).toBe('implementing');
    expect(calls[0].args).toEqual([
      'issue',
      'view',
      '42',
      '--repo',
      'acme/widgets',
      '--json',
      'labels'
    ]);
  });

  it('throws MultipleStateLabelsError when more than one state:* label is set', async () => {
    const { runner } = buildRunner(() => ({
      stdout: JSON.stringify({
        labels: [{ name: 'state:planned' }, { name: 'state:approved' }]
      })
    }));

    await expect(readState(repo, 42, { gh: runner })).rejects.toBeInstanceOf(MultipleStateLabelsError);
  });

  it('throws InvalidStateLabelError when a state:* label has an unknown suffix', async () => {
    const { runner } = buildRunner(() => ({
      stdout: JSON.stringify({ labels: [{ name: 'state:bogus' }] })
    }));

    await expect(readState(repo, 42, { gh: runner })).rejects.toBeInstanceOf(InvalidStateLabelError);
  });

  it('throws InvalidStateLabelError even when a known state:* label is also present', async () => {
    const { runner } = buildRunner(() => ({
      stdout: JSON.stringify({
        labels: [{ name: 'state:planned' }, { name: 'state:bogus' }]
      })
    }));

    await expect(readState(repo, 42, { gh: runner })).rejects.toBeInstanceOf(InvalidStateLabelError);
  });

  it('wraps malformed gh output in a helpful error message', async () => {
    const { runner } = buildRunner(() => ({ stdout: 'not json' }));

    await expect(readState(repo, 42, { gh: runner })).rejects.toThrow(/Failed to parse .* issue #42/);
  });
});

describe('writeState', () => {
  it('rejects an invalid transition before touching gh', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await expect(writeState(repo, 42, 'triaged', 'merged', { gh: runner })).rejects.toBeInstanceOf(
      InvalidTransitionError
    );
    expect(calls).toEqual([]);
  });

  it('is a no-op for self-transitions', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await writeState(repo, 42, 'implementing', 'implementing', { gh: runner });

    expect(calls).toEqual([]);
  });

  it('creates the target label up-front before swapping', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await writeState(repo, 42, 'triaged', 'planned', { gh: runner });

    expect(calls).toHaveLength(2);
    expect(calls[0].args).toEqual([
      'label',
      'create',
      'state:planned',
      '--repo',
      'acme/widgets',
      '--color',
      'C5DEF5',
      '--description',
      'IssueFlow workflow state: planned',
      '--force'
    ]);
    expect(calls[1].args).toEqual([
      'issue',
      'edit',
      '42',
      '--repo',
      'acme/widgets',
      '--remove-label',
      'state:triaged',
      '--add-label',
      'state:planned'
    ]);
  });
});

describe('ensureStateLabels', () => {
  it('creates every state:* label idempotently with --force', async () => {
    const { runner, calls } = buildRunner(() => ({ stdout: '' }));

    await ensureStateLabels(repo, { gh: runner });

    expect(calls).toHaveLength(9);
    for (const call of calls) {
      expect(call.args[0]).toBe('label');
      expect(call.args[1]).toBe('create');
      expect(call.args).toContain('--force');
      expect(call.args[2].startsWith(STATE_LABEL_PREFIX)).toBe(true);
    }
  });
});

describe('defaultRunner', () => {
  it('throws a friendly "GitHub CLI" message when execa rejects without an exitCode (spawn failure)', async () => {
    // Real execa 9 spawn failures (e.g. missing `gh` binary) reject with an
    // ExecaError whose `exitCode` is undefined. Mirror that shape with a plain
    // Error that has no `exitCode` property.
    vi.mocked(execa).mockRejectedValueOnce(new Error('spawn gh ENOENT'));

    await expect(defaultRunner(['issue', 'view', '1'])).rejects.toThrow(/GitHub CLI/);
  });

  it('passes through non-zero exit codes without throwing', async () => {
    vi.mocked(execa).mockRejectedValueOnce(
      Object.assign(new Error('command failed'), {
        exitCode: 1,
        stderr: 'gh: no auth',
        stdout: '',
        failed: true,
        shortMessage: 'Command failed with exit code 1: gh issue view 1'
      })
    );

    const result = await defaultRunner(['issue', 'view', '1']);
    expect(result).toEqual({ exitCode: 1, stderr: 'gh: no auth', stdout: '' });
  });
});
