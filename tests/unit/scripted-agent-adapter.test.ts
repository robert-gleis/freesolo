import { describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';

describe('ScriptedAgentAdapter', () => {
  describe('initial state', () => {
    it('reports state "idle" before start() is called', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });

      const status = await adapter.status();

      expect(status.state).toBe('idle');
      expect(status.startedAt).toBeUndefined();
      expect(status.lastActivityAt).toBeUndefined();
      expect(status.error).toBeUndefined();
    });
  });

  describe('start()', () => {
    it('transitions idle → running and records startedAt', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });

      await adapter.start({ workingDirectory: '/tmp/work' });
      const status = await adapter.status();

      expect(status.state).toBe('running');
      expect(status.startedAt).toBeInstanceOf(Date);
    });

    it('rejects with invalid-state when called twice without stop', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });
      await adapter.start({ workingDirectory: '/tmp/work' });

      await expect(adapter.start({ workingDirectory: '/tmp/work' })).rejects.toMatchObject({
        name: 'AgentAdapterError',
        code: 'invalid-state'
      });
    });
  });

  describe('stop()', () => {
    it('transitions running → stopped', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });
      await adapter.start({ workingDirectory: '/tmp/work' });

      await adapter.stop();
      const status = await adapter.status();

      expect(status.state).toBe('stopped');
    });

    it('is a no-op when never started', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });

      await expect(adapter.stop()).resolves.toBeUndefined();
      const status = await adapter.status();
      expect(status.state).toBe('idle');
    });

    it('is idempotent when already stopped', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });
      await adapter.start({ workingDirectory: '/tmp/work' });
      await adapter.stop();

      await expect(adapter.stop()).resolves.toBeUndefined();
      const status = await adapter.status();
      expect(status.state).toBe('stopped');
    });
  });

  describe('send() happy path', () => {
    it('returns the output of the first matching step (string match)', async () => {
      const adapter = new ScriptedAgentAdapter({
        steps: [
          { match: 'ping', output: 'pong' },
          { match: 'ping', output: 'wrong' }
        ]
      });
      await adapter.start({ workingDirectory: '/tmp/work' });

      const response = await adapter.send('ping');

      expect(response.output).toBe('pong');
    });

    it('returns the output of the first matching step (regex match)', async () => {
      const adapter = new ScriptedAgentAdapter({
        steps: [{ match: /^hello/i, output: 'hi' }]
      });
      await adapter.start({ workingDirectory: '/tmp/work' });

      const response = await adapter.send('Hello world');

      expect(response.output).toBe('hi');
    });

    it('updates lastActivityAt on successful send', async () => {
      const adapter = new ScriptedAgentAdapter({
        steps: [{ match: 'ping', output: 'pong' }]
      });
      await adapter.start({ workingDirectory: '/tmp/work' });
      const startedAt = (await adapter.status()).startedAt;

      const before = (await adapter.status()).lastActivityAt;
      await adapter.send('ping');
      const after = (await adapter.status()).lastActivityAt;

      expect(before).toBeUndefined();
      expect(after).toBeInstanceOf(Date);
      expect(after!.getTime()).toBeGreaterThanOrEqual(startedAt!.getTime());
    });
  });

  describe('send() failure semantics', () => {
    it('returns fallback when no step matches', async () => {
      const adapter = new ScriptedAgentAdapter({
        steps: [{ match: 'ping', output: 'pong' }],
        fallback: 'unknown'
      });
      await adapter.start({ workingDirectory: '/tmp/work' });

      const response = await adapter.send('what?');

      expect(response.output).toBe('unknown');
    });

    it('rejects with send-failed when no step matches and no fallback is set', async () => {
      const adapter = new ScriptedAgentAdapter({
        steps: [{ match: 'ping', output: 'pong' }]
      });
      await adapter.start({ workingDirectory: '/tmp/work' });

      await expect(adapter.send('nope')).rejects.toMatchObject({
        name: 'AgentAdapterError',
        code: 'send-failed'
      });
    });

    it('rejects with invalid-state when called before start', async () => {
      const adapter = new ScriptedAgentAdapter({ steps: [] });

      await expect(adapter.send('ping')).rejects.toMatchObject({
        name: 'AgentAdapterError',
        code: 'invalid-state'
      });
    });

    it('rejects with invalid-state when called after stop', async () => {
      const adapter = new ScriptedAgentAdapter({
        steps: [{ match: 'ping', output: 'pong' }]
      });
      await adapter.start({ workingDirectory: '/tmp/work' });
      await adapter.stop();

      await expect(adapter.send('ping')).rejects.toMatchObject({
        name: 'AgentAdapterError',
        code: 'invalid-state'
      });
    });
  });
});
