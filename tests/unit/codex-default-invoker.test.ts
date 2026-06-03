import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentAdapterError } from '../../src/agents/types.js';
import { createDefaultInvoker } from '../../src/agents/codex.js';

const execaMock = vi.fn();

vi.mock('execa', () => ({
  execa: (...args: unknown[]) => execaMock(...args)
}));

describe('createDefaultInvoker', () => {
  beforeEach(() => {
    execaMock.mockReset();
  });

  it('runs first-turn exec with skip-git-repo-check', async () => {
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"done"}}'
      ].join('\n'),
      stderr: ''
    });

    const invoker = createDefaultInvoker('codex');
    const result = await invoker({ cwd: '/wt', prompt: 'hello' });

    expect(result).toEqual({ threadId: 't1', output: 'done' });
    expect(execaMock).toHaveBeenCalledWith(
      'codex',
      ['exec', '--json', '-C', '/wt', '--skip-git-repo-check', 'hello'],
      { cwd: '/wt', reject: false }
    );
  });

  it('runs resume without skip-git-repo-check', async () => {
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: [
        '{"type":"thread.started","thread_id":"t1"}',
        '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"resumed"}}'
      ].join('\n'),
      stderr: ''
    });

    const invoker = createDefaultInvoker('codex');
    await invoker({ cwd: '/wt', prompt: 'continue', threadId: 't1' });

    expect(execaMock).toHaveBeenCalledWith(
      'codex',
      ['exec', 'resume', 't1', '--json', '-C', '/wt', 'continue'],
      { cwd: '/wt', reject: false }
    );
  });

  it('maps non-zero exit to send-failed with stderr', async () => {
    execaMock.mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'auth required'
    });

    const invoker = createDefaultInvoker('codex');
    await expect(invoker({ cwd: '/wt', prompt: 'go' })).rejects.toMatchObject({
      name: 'AgentAdapterError',
      code: 'send-failed',
      message: expect.stringContaining('auth required')
    });
  });

  it('wraps parser failures as send-failed', async () => {
    execaMock.mockResolvedValue({
      exitCode: 0,
      stdout: '{"type":"turn.started"}',
      stderr: ''
    });

    const invoker = createDefaultInvoker('codex');
    await expect(invoker({ cwd: '/wt', prompt: 'go' })).rejects.toMatchObject({
      code: 'send-failed',
      message: expect.stringMatching(/thread_id/)
    });
  });
});
