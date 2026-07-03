import { describe, expect, it } from 'vitest';

import { runOwnedAgentSession } from '../../src/agents/agent-lifecycle.js';
import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import type { AgentAdapter } from '../../src/agents/types.js';

function hangingAdapter(): AgentAdapter {
  let state: 'idle' | 'running' | 'stopped' = 'idle';
  return {
    start: async () => {
      state = 'running';
    },
    stop: async () => {
      state = 'stopped';
    },
    send: () => new Promise(() => {}),
    status: async () => ({ state })
  };
}

describe('runOwnedAgentSession', () => {
  it('starts an idle adapter, runs work, and stops it on success', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: 'hi' }] });
    expect((await adapter.status()).state).toBe('idle');

    const result = await runOwnedAgentSession(
      { adapter, cwd: '/tmp' },
      async (send) => `work:${await send('go')}`,
      () => 'ABORT',
      () => 'ERROR'
    );

    expect(result).toBe('work:hi');
    expect((await adapter.status()).state).toBe('stopped');
  });

  it('does NOT stop an adapter it did not start (already running)', async () => {
    let stopped = false;
    const adapter: AgentAdapter = {
      start: async () => {},
      stop: async () => {
        stopped = true;
      },
      send: async () => ({ output: 'out' }),
      status: async () => ({ state: 'running' })
    };

    await runOwnedAgentSession(
      { adapter, cwd: '/tmp' },
      async (send) => send('go'),
      () => 'ABORT',
      () => 'ERROR'
    );

    expect(stopped).toBe(false);
  });

  it('maps a send error via onError and stops the owned adapter', async () => {
    let stopped = false;
    const adapter: AgentAdapter = {
      start: async () => {},
      stop: async () => {
        stopped = true;
      },
      send: async () => {
        throw new Error('boom');
      },
      status: async () => ({ state: 'idle' })
    };

    const result = await runOwnedAgentSession(
      { adapter, cwd: '/tmp' },
      async (send) => send('go'),
      () => 'ABORT',
      (msg) => `ERROR:${msg}`
    );

    expect(result).toBe('ERROR:boom');
    expect(stopped).toBe(true);
  });

  it('maps a timeout via onAbort and stops the owned adapter', async () => {
    const adapter = hangingAdapter();

    const result = await runOwnedAgentSession(
      { adapter, cwd: '/tmp', timeoutSeconds: 0.01 },
      async (send) => send('go'),
      () => 'ABORTED',
      () => 'ERROR'
    );

    expect(result).toBe('ABORTED');
    expect((await adapter.status()).state).toBe('stopped');
  });

  it('maps an external abort via onAbort', async () => {
    const adapter = hangingAdapter();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await runOwnedAgentSession(
      { adapter, cwd: '/tmp', abortSignal: controller.signal },
      async (send) => send('go'),
      () => 'ABORTED',
      () => 'ERROR'
    );

    expect(result).toBe('ABORTED');
  });

  it('never lets a stop() failure override the work result', async () => {
    const adapter: AgentAdapter = {
      start: async () => {},
      stop: async () => {
        throw new Error('stop failed');
      },
      send: async () => ({ output: 'out' }),
      status: async () => ({ state: 'idle' })
    };

    const result = await runOwnedAgentSession(
      { adapter, cwd: '/tmp' },
      async (send) => `ok:${await send('go')}`,
      () => 'ABORT',
      () => 'ERROR'
    );

    expect(result).toBe('ok:out');
  });
});
