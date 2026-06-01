import { describe, expect, it } from 'vitest';

import {
  AgentAdapterError,
  type AgentAdapter,
  type AgentStartInput,
  type AgentState,
  type AgentStatus,
} from '../../src/agents/types.js';

describe('AgentAdapter (structural)', () => {
  it('accepts a minimal in-line implementation', async () => {
    const adapter: AgentAdapter = {
      start: async () => {},
      stop: async () => {},
      send: async () => ({ output: 'ok' }),
      status: async (): Promise<AgentStatus> => ({ state: 'idle' })
    };

    const status = await adapter.status();
    const response = await adapter.send('hello');

    expect(status.state).toBe('idle');
    expect(response.output).toBe('ok');
  });

  it('AgentStartInput preserves initialInstructions on the structural type', () => {
    const input: AgentStartInput = {
      workingDirectory: '/tmp/work',
      initialInstructions: 'be helpful'
    };

    expect(input.initialInstructions).toBe('be helpful');
  });

  it('pins the AgentState union shape', () => {
    const _allStates: AgentState[] = ['idle', 'starting', 'running', 'stopping', 'stopped', 'error'];
    expect(_allStates).toHaveLength(6);
  });
});

describe('AgentAdapterError', () => {
  it('carries a code and message and is an Error', () => {
    const error = new AgentAdapterError('invalid-state', 'wrong state');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AgentAdapterError');
    expect(error.code).toBe('invalid-state');
    expect(error.message).toBe('wrong state');
  });

  it('supports every documented error code', () => {
    const codes = ['invalid-state', 'start-failed', 'send-failed', 'stop-failed'] as const;
    for (const code of codes) {
      const error = new AgentAdapterError(code, 'msg');
      expect(error.code).toBe(code);
    }
  });
});
