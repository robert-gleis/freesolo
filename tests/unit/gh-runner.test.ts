import { beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultRunner } from '../../src/core/gh.js';

vi.mock('execa', () => ({ execa: vi.fn() }));
const { execa } = await import('execa');

beforeEach(() => {
  vi.mocked(execa).mockReset();
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

  it('returns stdout and exit code 0 on success', async () => {
    vi.mocked(execa).mockResolvedValueOnce({
      stdout: 'ok',
      stderr: '',
      exitCode: 0
    } as never);

    const result = await defaultRunner(['issue', 'view', '1']);
    expect(result).toEqual({ exitCode: 0, stderr: '', stdout: 'ok' });
  });
});
