import { describe, expect, it, vi } from 'vitest';

import { CodexAgentAdapter } from '../../src/agents/codex.js';
import { createWorkflowEngine } from '../../src/workflow/engine.js';
import type { EngineAction } from '../../src/workflow/policy.js';

describe('CodexAgentAdapter + workflow engine', () => {
  it('spawn tick starts adapter and sends instructions', async () => {
    const invoker = vi.fn().mockResolvedValue({ threadId: 't1', output: 'done' });
    const agent = new CodexAgentAdapter({ invoker });
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

    const engine = createWorkflowEngine({
      readState,
      writeState,
      policy,
      agent,
      loadKnowledgeEntries: async () => []
    });
    const eventKinds: string[] = [];
    engine.on((event) => {
      eventKinds.push(event.kind);
    });
    const result = await engine.tick({ repo: { owner: 'o', repo: 'r' }, issueNumber: 40 });

    expect(result.toState).toBe('reviewing');
    expect(invoker).toHaveBeenCalledTimes(1);
    expect(invoker).toHaveBeenCalledWith({
      cwd: process.cwd(),
      prompt: 'implement feature',
      threadId: undefined
    });
    expect((await agent.status()).state).toBe('running');
    expect(eventKinds).toEqual(['decision', 'transition']);
  });
});
