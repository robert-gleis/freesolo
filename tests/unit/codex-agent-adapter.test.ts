import { describe, expect, it, vi } from 'vitest';

import { AgentAdapterError } from '../../src/agents/types.js';
import {
  CodexAgentAdapter,
  type CodexInvoker,
  type CodexInvokeResult
} from '../../src/agents/codex.js';

function mockInvoker(result: CodexInvokeResult): CodexInvoker {
  return vi.fn().mockResolvedValue(result);
}

describe('CodexAgentAdapter initial state', () => {
  it('reports state idle before start', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    const status = await adapter.status();
    expect(status.state).toBe('idle');
    expect(status.startedAt).toBeUndefined();
    expect(status.lastActivityAt).toBeUndefined();
    expect(status.error).toBeUndefined();
  });
});

describe('CodexAgentAdapter start', () => {
  it('transitions idle to running and records startedAt without invoking', async () => {
    const invoker = mockInvoker({ threadId: 't', output: 'ok' });
    const adapter = new CodexAgentAdapter({ invoker });

    await adapter.start({
      workingDirectory: process.cwd(),
      initialInstructions: 'implement feature'
    });

    const status = await adapter.status();
    expect(status.state).toBe('running');
    expect(status.startedAt).toBeInstanceOf(Date);
    expect(invoker).not.toHaveBeenCalled();
  });

  it('rejects with start-failed when workingDirectory does not exist', async () => {
    const adapter = new CodexAgentAdapter({
      invoker: mockInvoker({ threadId: 't', output: 'ok' })
    });

    await expect(
      adapter.start({ workingDirectory: '/path/that-does-not-exist-freesolo-40' })
    ).rejects.toMatchObject({
      name: 'AgentAdapterError',
      code: 'start-failed'
    });
  });

  it('rejects with invalid-state on double start', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.start({ workingDirectory: process.cwd() })).rejects.toMatchObject({
      code: 'invalid-state'
    });
  });

  it('allows start from stopped after stop', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.stop();
    await adapter.start({ workingDirectory: process.cwd() });
    expect((await adapter.status()).state).toBe('running');
  });
});

describe('CodexAgentAdapter stop', () => {
  it('is a no-op when never started', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await adapter.stop();
    expect((await adapter.status()).state).toBe('idle');
  });

  it('transitions running to stopped', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');
  });

  it('is idempotent when already stopped', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.stop();
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');
  });

  it('clears lastActivityAt on restart after stop', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ threadId: 't1', output: 'one' })
      .mockResolvedValueOnce({ threadId: 't2', output: 'two' });
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('first');
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);
    await adapter.stop();
    await adapter.start({ workingDirectory: process.cwd() });
    expect((await adapter.status()).lastActivityAt).toBeUndefined();
    await adapter.send('second');
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);
  });
});

describe('CodexAgentAdapter send', () => {
  it('returns invoker output and stores threadId', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ threadId: 'thread-a', output: 'one' })
      .mockResolvedValueOnce({ threadId: 'thread-a', output: 'two' });
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    const first = await adapter.send('first');
    expect(first.output).toBe('one');
    expect(invoker).toHaveBeenCalledWith({
      cwd: process.cwd(),
      prompt: 'first',
      threadId: undefined,
      signal: undefined
    });

    const second = await adapter.send('second');
    expect(second.output).toBe('two');
    expect(invoker.mock.calls[1][0]).toEqual({
      cwd: process.cwd(),
      prompt: 'second',
      threadId: 'thread-a',
      signal: undefined
    });
  });

  it('forwards the send signal into the invoker so the child can be cancelled', async () => {
    const invoker = vi.fn().mockResolvedValue({ threadId: 't', output: 'ok' });
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    const controller = new AbortController();

    await adapter.send('go', { signal: controller.signal });

    expect(invoker).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('updates lastActivityAt on successful send', async () => {
    const adapter = new CodexAgentAdapter({
      invoker: mockInvoker({ threadId: 't', output: 'ok' })
    });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('go');
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);
  });

  it('rejects with invalid-state before start', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await expect(adapter.send('nope')).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('transitions to error and sets status.error on invoker failure', async () => {
    const invoker = vi.fn().mockRejectedValue(new Error('network'));
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.send('go')).rejects.toMatchObject({ code: 'send-failed' });
    expect((await adapter.status()).state).toBe('error');
    expect((await adapter.status()).error).toMatch(/network/);
  });

  it('rejects subsequent send with invalid-state after error', async () => {
    const invoker = vi.fn().mockRejectedValue(new Error('fail'));
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await expect(adapter.send('go')).rejects.toMatchObject({ code: 'send-failed' });

    await expect(adapter.send('again')).rejects.toMatchObject({ code: 'invalid-state' });
    expect(invoker).toHaveBeenCalledTimes(1);
  });

  it('rethrows AgentAdapterError from invoker unchanged', async () => {
    const upstream = new AgentAdapterError('send-failed', 'upstream');
    const invoker = vi.fn().mockRejectedValue(upstream);
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.send('go')).rejects.toBe(upstream);
  });

  it('wraps non-AgentAdapterError rejections as send-failed', async () => {
    const invoker = vi.fn().mockRejectedValue(new Error('network'));
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.send('go')).rejects.toMatchObject({
      name: 'AgentAdapterError',
      code: 'send-failed',
      message: 'network'
    });
  });

  it('rejects with invalid-state after stop', async () => {
    const adapter = new CodexAgentAdapter({ invoker: mockInvoker({ threadId: 't', output: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('tick');
    await adapter.stop();
    await expect(adapter.send('ping')).rejects.toMatchObject({ code: 'invalid-state' });
  });
});

describe('CodexAgentAdapter stop from error', () => {
  it('rejects start while in error state', async () => {
    const invoker = vi.fn().mockRejectedValue(new Error('boom'));
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await expect(adapter.send('go')).rejects.toMatchObject({ code: 'send-failed' });

    await expect(adapter.start({ workingDirectory: process.cwd() })).rejects.toMatchObject({
      code: 'invalid-state'
    });
  });

  it('stop from error clears threadId and allows recovery on same adapter', async () => {
    const invoker = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ threadId: 'new', output: 'ok' });
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await expect(adapter.send('go')).rejects.toMatchObject({ code: 'send-failed' });
    expect((await adapter.status()).state).toBe('error');

    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');

    await adapter.start({ workingDirectory: process.cwd() });
    expect((await adapter.status()).error).toBeUndefined();
    await adapter.send('after');
    expect(invoker.mock.calls[1][0]).toEqual({
      cwd: process.cwd(),
      prompt: 'after',
      threadId: undefined
    });
  });

  it('stop clears threadId so next send after restart starts fresh session', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ threadId: 'thread-a', output: 'one' })
      .mockResolvedValueOnce({ threadId: 'thread-b', output: 'two' });
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('first');
    await adapter.stop();
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('second');
    expect(invoker.mock.calls[1][0].threadId).toBeUndefined();
  });
});
