import { describe, expect, it, vi } from 'vitest';

import { ClaudeCodeAgentAdapter } from '../../src/agents/claude-code.js';
import { createWorkflowEngine } from '../../src/workflow/engine.js';
import type { EngineAction } from '../../src/workflow/policy.js';

describe('ClaudeCodeAgentAdapter + workflow engine', () => {
  it('spawn tick starts adapter and sends instructions', async () => {
    const invoker = vi.fn().mockResolvedValue({ result: 'done', session_id: 's1' });
    const agent = new ClaudeCodeAgentAdapter({ invoker });
    const readState = vi.fn().mockResolvedValue('implementing');
    const writeState = vi.fn().mockResolvedValue(undefined);
    const policy = vi.fn(
      (): EngineAction => ({
        kind: 'spawn',
        agent: {
          workingDirectory: process.cwd(),
          initialInstructions: 'implement feature'
        },
        nextState: 'reviewing'
      })
    );

    const engine = createWorkflowEngine({ readState, writeState, policy, agent });
    const eventKinds: string[] = [];
    engine.on((event) => {
      eventKinds.push(event.kind);
    });
    const result = await engine.tick({ repo: { owner: 'o', repo: 'r' }, issueNumber: 39 });

    expect(result.toState).toBe('reviewing');
    expect(invoker).toHaveBeenCalledTimes(1);
    expect(invoker).toHaveBeenCalledWith({
      cwd: process.cwd(),
      prompt: 'implement feature',
      sessionId: undefined
    });
    expect((await agent.status()).state).toBe('running');
    expect(eventKinds).toEqual(['decision', 'transition']);
  });
});
