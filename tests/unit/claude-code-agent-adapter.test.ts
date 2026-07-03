import { describe, expect, it, vi } from 'vitest';

import { AgentAdapterError } from '../../src/agents/types.js';
import {
  ClaudeCodeAgentAdapter,
  type ClaudeInvoker,
  type ClaudePrintJson
} from '../../src/agents/claude-code.js';

function mockInvoker(response: ClaudePrintJson): ClaudeInvoker {
  return vi.fn().mockResolvedValue(response);
}

describe('ClaudeCodeAgentAdapter lifecycle', () => {
  it('reports idle before start', async () => {
    const adapter = new ClaudeCodeAgentAdapter({ invoker: mockInvoker({ result: 'ok' }) });
    expect((await adapter.status()).state).toBe('idle');
  });

  it('start moves to running and sets startedAt without invoking', async () => {
    const invoker = mockInvoker({ result: 'ignored', session_id: 'sess-1' });
    const adapter = new ClaudeCodeAgentAdapter({ invoker });

    await adapter.start({
      workingDirectory: process.cwd(),
      initialInstructions: 'implement feature'
    });

    const status = await adapter.status();
    expect(status.state).toBe('running');
    expect(status.startedAt).toBeInstanceOf(Date);
    expect(invoker).not.toHaveBeenCalled();
  });

  it('maps inaccessible working directory to start-failed', async () => {
    const adapter = new ClaudeCodeAgentAdapter({
      invoker: mockInvoker({ result: 'ok', session_id: 's' })
    });

    await expect(
      adapter.start({ workingDirectory: '/path/that-does-not-exist-issueflow-39' })
    ).rejects.toMatchObject({
      name: 'AgentAdapterError',
      code: 'start-failed'
    });
  });

  it('rejects start when already running', async () => {
    const adapter = new ClaudeCodeAgentAdapter({
      invoker: mockInvoker({ result: 'ok', session_id: 's' })
    });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.start({ workingDirectory: process.cwd() })).rejects.toMatchObject({
      name: 'AgentAdapterError',
      code: 'invalid-state'
    });
  });
});

describe('ClaudeCodeAgentAdapter send', () => {
  it('invokes claude and returns result text', async () => {
    const invoker = vi.fn().mockResolvedValue({ result: 'hello', session_id: 'abc' });
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    const response = await adapter.send('do work');

    expect(response.output).toBe('hello');
    expect(invoker).toHaveBeenCalledWith({
      cwd: process.cwd(),
      prompt: 'do work',
      sessionId: undefined,
      signal: undefined
    });
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);
  });

  it('passes sessionId on subsequent send', async () => {
    const invoker = vi
      .fn()
      .mockResolvedValueOnce({ result: 'one', session_id: 'sess-99' })
      .mockResolvedValueOnce({ result: 'two', session_id: 'sess-99' });
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('first');
    await adapter.send('second');

    expect(invoker.mock.calls[1][0]).toEqual({
      cwd: process.cwd(),
      prompt: 'second',
      sessionId: 'sess-99',
      signal: undefined
    });
  });

  it('forwards the send signal into the invoker so the child can be cancelled', async () => {
    const invoker = vi.fn().mockResolvedValue({ result: 'ok', session_id: 's' });
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    const controller = new AbortController();

    await adapter.send('go', { signal: controller.signal });

    expect(invoker).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal })
    );
  });

  it('rejects send when not running', async () => {
    const adapter = new ClaudeCodeAgentAdapter({ invoker: mockInvoker({ result: 'x' }) });
    await expect(adapter.send('nope')).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('rejects when JSON marks error', async () => {
    const adapter = new ClaudeCodeAgentAdapter({
      invoker: mockInvoker({ is_error: true, result: 'fail' })
    });
    await adapter.start({ workingDirectory: process.cwd() });
    await expect(adapter.send('go')).rejects.toMatchObject({ code: 'send-failed' });
  });

  it('rejects when result field missing', async () => {
    const adapter = new ClaudeCodeAgentAdapter({ invoker: mockInvoker({ session_id: 's' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await expect(adapter.send('go')).rejects.toMatchObject({ code: 'send-failed' });
  });

  it('wraps non-AgentAdapterError invoker failures as send-failed', async () => {
    const invoker = vi.fn().mockRejectedValue(new Error('boom'));
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.send('go')).rejects.toMatchObject({
      name: 'AgentAdapterError',
      code: 'send-failed'
    });
  });

  it('rethrows AgentAdapterError from invoker unchanged', async () => {
    const invoker = vi
      .fn()
      .mockRejectedValue(new AgentAdapterError('send-failed', 'claude exited 1'));
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    await expect(adapter.send('go')).rejects.toMatchObject({
      code: 'send-failed',
      message: 'claude exited 1'
    });
  });

  it('rejects send after stop', async () => {
    const adapter = new ClaudeCodeAgentAdapter({ invoker: mockInvoker({ result: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.stop();

    await expect(adapter.send('ping')).rejects.toMatchObject({ code: 'invalid-state' });
  });
});

describe('ClaudeCodeAgentAdapter stop', () => {
  it('is no-op from idle', async () => {
    const adapter = new ClaudeCodeAgentAdapter({ invoker: mockInvoker({ result: 'x' }) });
    await adapter.stop();
    expect((await adapter.status()).state).toBe('idle');
  });

  it('clears session and moves to stopped from running', async () => {
    const invoker = mockInvoker({ result: 'ok', session_id: 's1' });
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('ping');
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');

    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('again');
    expect(invoker).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: undefined })
    );
  });

  it('is idempotent when already stopped', async () => {
    const adapter = new ClaudeCodeAgentAdapter({ invoker: mockInvoker({ result: 'ok' }) });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.stop();
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');
  });

  it('clears lastActivityAt on restart', async () => {
    const invoker = mockInvoker({ result: 'ok', session_id: 's' });
    const adapter = new ClaudeCodeAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });
    await adapter.send('ping');
    expect((await adapter.status()).lastActivityAt).toBeInstanceOf(Date);

    await adapter.stop();
    await adapter.start({ workingDirectory: process.cwd() });
    expect((await adapter.status()).lastActivityAt).toBeUndefined();
  });
});
