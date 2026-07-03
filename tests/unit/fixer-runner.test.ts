import { describe, expect, it } from 'vitest';

import { CodexAgentAdapter, type CodexInvoker } from '../../src/agents/codex.js';
import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import { runFixerAgent } from '../../src/agents/fixer-runner.js';
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

describe('runFixerAgent', () => {
  it('returns ok when the agent completes normally', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'done, applied the minimal fix' }]
    });

    const result = await runFixerAgent({ adapter, prompt: 'fix this', cwd: '/tmp' });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('applied the minimal fix');
  });

  it('does NOT require a verdict — any normal completion counts as ok', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'no json, no verdict, just chatter' }]
    });

    const result = await runFixerAgent({ adapter, prompt: 'fix this', cwd: '/tmp' });

    expect(result.ok).toBe(true);
  });

  it('returns ok:false when the adapter send throws', async () => {
    const adapter: AgentAdapter = {
      start: async () => {},
      stop: async () => {},
      send: async () => {
        throw new Error('agent crashed');
      },
      status: async () => ({ state: 'idle' })
    };

    const result = await runFixerAgent({ adapter, prompt: 'fix this', cwd: '/tmp' });

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('agent crashed');
  });

  it('returns ok:false when the timeout elapses before the agent responds', async () => {
    const adapter = hangingAdapter();

    const result = await runFixerAgent({
      adapter,
      prompt: 'fix',
      cwd: '/tmp',
      timeoutSeconds: 0.01
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/timed out|timeout|abort/i);
  });

  it('returns ok:false when an external abort signal fires', async () => {
    const adapter = hangingAdapter();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const result = await runFixerAgent({
      adapter,
      prompt: 'fix',
      cwd: '/tmp',
      abortSignal: controller.signal
    });

    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/abort|cancel/i);
  });

  it('starts an idle adapter and stops it on success', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'done' }]
    });
    expect((await adapter.status()).state).toBe('idle');

    await runFixerAgent({ adapter, prompt: 'fix', cwd: '/tmp' });

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('stops an owned adapter after a timeout', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    adapter.send = () => new Promise(() => {});

    await runFixerAgent({ adapter, prompt: 'fix', cwd: '/tmp', timeoutSeconds: 0.01 });

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('cancels the spawned subprocess when the timeout fires (signal reaches the invoker)', async () => {
    // A real adapter with a fake invoker that never resolves until its signal
    // aborts — mirroring a host-agent process that keeps editing the tree. This
    // proves the timeout actually reaches the child rather than leaking it.
    //
    // The adapter is PRE-STARTED so runOwnedAgentSession skips start()'s real
    // fs.access — otherwise a 0.01s timeout can win the race against that pre-send
    // I/O, send() never runs, and seenSignal stays undefined (a flake). With no
    // pre-send I/O the invoker captures the signal synchronously before the
    // timeout can fire.
    let seenSignal: AbortSignal | undefined;
    const invoker: CodexInvoker = ({ signal }) =>
      new Promise((_resolve, reject) => {
        seenSignal = signal;
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      });
    const adapter = new CodexAgentAdapter({ invoker });
    await adapter.start({ workingDirectory: process.cwd() });

    const result = await runFixerAgent({
      adapter,
      prompt: 'fix',
      cwd: process.cwd(),
      timeoutSeconds: 0.01
    });

    expect(result.ok).toBe(false);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal!.aborted).toBe(true);
  });

  it('cancels the spawned subprocess when an external abort fires', async () => {
    // Drive the abort from INSIDE the invoker (once send is entered and the
    // signal captured) rather than a wall-clock setTimeout, so the assertion
    // cannot race the pre-send status()/start() I/O and flake with seenSignal
    // === undefined.
    let seenSignal: AbortSignal | undefined;
    const external = new AbortController();
    const invoker: CodexInvoker = ({ signal }) =>
      new Promise((_resolve, reject) => {
        seenSignal = signal;
        signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
        external.abort();
      });
    const adapter = new CodexAgentAdapter({ invoker });

    const result = await runFixerAgent({
      adapter,
      prompt: 'fix',
      cwd: process.cwd(),
      abortSignal: external.signal
    });

    expect(result.ok).toBe(false);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal!.aborted).toBe(true);
  });

  it('stops an owned adapter after an adapter error', async () => {
    let stopped = false;
    let started = false;
    const adapter: AgentAdapter = {
      start: async () => {
        started = true;
      },
      stop: async () => {
        stopped = true;
      },
      send: async () => {
        throw new Error('boom');
      },
      status: async () => ({ state: started && !stopped ? 'running' : 'idle' })
    };

    await runFixerAgent({ adapter, prompt: 'fix', cwd: '/tmp' });

    expect(stopped).toBe(true);
  });
});
