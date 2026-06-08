import { describe, expect, it, vi } from 'vitest';

import { CursorAgentAdapter, type CursorAgentDeps } from '../../src/agents/cursor.js';

function fakeDeps(impl: CursorAgentDeps['run']): CursorAgentDeps {
  return { binary: 'cursor-agent', run: impl };
}

describe('CursorAgentAdapter', () => {
  it('reports idle before start', async () => {
    const adapter = new CursorAgentAdapter(fakeDeps(async () => ({ sessionId: 's', output: '' })));
    expect((await adapter.status()).state).toBe('idle');
  });

  it('start without initialInstructions calls create-chat via run', async () => {
    const run = vi.fn(async () => ({ sessionId: 'chat-1', output: '' }));
    const adapter = new CursorAgentAdapter(fakeDeps(run));

    await adapter.start({ workingDirectory: '/wt/issue-50' });

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toEqual(['create-chat']);
    expect(run.mock.calls[0][1]).toEqual({ cwd: '/wt/issue-50' });
    expect((await adapter.status()).state).toBe('running');
    expect((await adapter.status()).startedAt).toBeInstanceOf(Date);
    expect((await adapter.status()).lastActivityAt).toBeUndefined();
  });

  it('start with initialInstructions still calls create-chat only (ignores prompt on start)', async () => {
    const run = vi.fn(async () => ({ sessionId: 'chat-1', output: '' }));
    const adapter = new CursorAgentAdapter(fakeDeps(run));

    await adapter.start({
      workingDirectory: '/wt/issue-50',
      initialInstructions: 'implement the feature'
    });

    expect(run).toHaveBeenCalledOnce();
    expect(run.mock.calls[0][0]).toEqual(['create-chat']);
    expect(run.mock.calls[0][0]).not.toContain('--print');
    expect(run.mock.calls[0][0]).not.toContain('implement the feature');
  });

  it('start failure transitions to error with start-failed code', async () => {
    const run = vi.fn(async () => {
      throw new Error('create-chat exited 1');
    });
    const adapter = new CursorAgentAdapter(fakeDeps(run));

    await expect(adapter.start({ workingDirectory: '/wt' })).rejects.toMatchObject({
      code: 'start-failed'
    });
    expect((await adapter.status()).state).toBe('error');
    expect((await adapter.status()).error).toMatch(/create-chat exited 1/);
  });

  it('stop when idle is a no-op', async () => {
    const adapter = new CursorAgentAdapter(fakeDeps(async () => ({ sessionId: 's', output: '' })));
    await adapter.stop();
    expect((await adapter.status()).state).toBe('idle');
  });

  it('send resumes session with prompt', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes('create-chat')) return { sessionId: 'chat-1', output: '' };
      return { sessionId: 'chat-1', output: 'done' };
    });
    const adapter = new CursorAgentAdapter(fakeDeps(run));
    await adapter.start({ workingDirectory: '/wt' });
    const response = await adapter.send('next step');
    expect(response.output).toBe('done');
    expect(run.mock.calls[1][0]).toContain('--resume');
    expect(run.mock.calls[1][0]).toContain('chat-1');
    expect(run.mock.calls[1][0]).toContain('--workspace');
    expect(run.mock.calls[1][0]).toContain('/wt');
    expect(run.mock.calls[1][0]).toContain('next step');
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);
  });

  it('send before start throws invalid-state', async () => {
    const adapter = new CursorAgentAdapter(fakeDeps(async () => ({ sessionId: 's', output: '' })));
    await expect(adapter.send('hi')).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('double start throws invalid-state', async () => {
    const adapter = new CursorAgentAdapter(fakeDeps(async () => ({ sessionId: 's', output: '' })));
    await adapter.start({ workingDirectory: '/wt' });
    await expect(adapter.start({ workingDirectory: '/wt' })).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('send failure transitions to error with send-failed code', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes('create-chat')) return { sessionId: 'chat-1', output: '' };
      throw new Error('resume exited 1');
    });
    const adapter = new CursorAgentAdapter(fakeDeps(run));
    await adapter.start({ workingDirectory: '/wt' });
    await expect(adapter.send('fail')).rejects.toMatchObject({ code: 'send-failed' });
    expect((await adapter.status()).state).toBe('error');
    expect((await adapter.status()).error).toMatch(/resume exited 1/);
  });

  it('stop clears session and allows restart', async () => {
    const run = vi.fn(async (args: string[]) => {
      if (args.includes('create-chat')) return { sessionId: 's', output: '' };
      return { sessionId: 's', output: 'tick' };
    });
    const adapter = new CursorAgentAdapter(fakeDeps(run));
    await adapter.start({ workingDirectory: '/wt' });
    await adapter.send('tick');
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');
    await adapter.start({ workingDirectory: '/wt' });
    expect((await adapter.status()).state).toBe('running');
    expect((await adapter.status()).lastActivityAt).toBeUndefined();
  });
});
