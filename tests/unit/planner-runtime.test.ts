import { describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import { PlannerError } from '../../src/planner/errors.js';
import {
  decomposeIssue,
  planTeam,
  runPlanner
} from '../../src/planner/runtime.js';
import type { PlannerIssue } from '../../src/planner/types.js';
import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';
import type { DecompositionPlan } from '../../src/planner/schemas/decomposition-plan.js';

const issue: PlannerIssue = {
  number: 1,
  title: 'A test issue',
  body: 'Test body.',
  labels: []
};

const validTeam: TeamDefinition = {
  roles: [{ name: 'Engineer', host: 'claude', responsibility: 'Do it.', count: 1 }]
};

const validDecomp: DecompositionPlan = {
  parent_issue: 1,
  children: [{ title: 'Part 1', body: '## Parent\n\n#1', labels: [] }]
};

describe('runPlanner happy path', () => {
  it('returns { task: "team", data } when task is "team"', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validTeam) }]
    });

    const result = await runPlanner({ adapter, task: 'team', issue });

    expect(result).toEqual({ task: 'team', data: validTeam });
  });

  it('returns { task: "decomposition", data } when task is "decomposition"', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validDecomp) }]
    });

    const result = await runPlanner({ adapter, task: 'decomposition', issue });

    expect(result).toEqual({ task: 'decomposition', data: validDecomp });
  });

  it('accepts a fenced JSON response', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [
        { match: /.*/, output: '```json\n' + JSON.stringify(validTeam) + '\n```' }
      ]
    });

    const result = await runPlanner({ adapter, task: 'team', issue });

    expect(result.task).toBe('team');
    if (result.task === 'team') {
      expect(result.data).toEqual(validTeam);
    }
  });
});

describe('runPlanner retry loop', () => {
  it('re-prompts on schema failure and accepts the corrected response', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [
        // First call: invalid (missing count)
        {
          match: /You are a planner agent/,
          output: JSON.stringify({
            roles: [{ name: 'Eng', host: 'claude', responsibility: 'Do it.' }]
          })
        },
        // Retry: valid — match against the rendered Zod issue surface so this
        // test fails if buildRetryPrompt is ever changed to drop the error
        // body (not just the preamble).
        {
          match: /Validation error:[\s\S]*(roles|required|count)/i,
          output: JSON.stringify(validTeam)
        }
      ]
    });

    const result = await runPlanner({
      adapter,
      task: 'team',
      issue,
      maxAttempts: 2
    });

    expect(result.task).toBe('team');
    if (result.task === 'team') {
      expect(result.data).toEqual(validTeam);
    }
  });

  it('throws invalid-output with ZodError after maxAttempts exhausted', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [
        {
          match: /.*/,
          output: JSON.stringify({ roles: [] }) // always invalid
        }
      ]
    });

    await expect(
      runPlanner({ adapter, task: 'team', issue, maxAttempts: 3 })
    ).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'invalid-output',
      details: expect.objectContaining({ attempts: 3 })
    });
  });

  it('does NOT retry on extract-failed', async () => {
    let sendCount = 0;
    const adapter = new ScriptedAgentAdapter({
      steps: [
        {
          match: /.*/,
          output: 'sorry, I cannot do that' // no JSON anywhere
        }
      ]
    });
    const originalSend = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      sendCount++;
      return originalSend(input);
    };

    await expect(
      runPlanner({ adapter, task: 'team', issue, maxAttempts: 5 })
    ).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'extract-failed'
    });
    expect(sendCount).toBe(1);
  });

  it('rejects maxAttempts of 0 synchronously', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });

    await expect(
      runPlanner({ adapter, task: 'team', issue, maxAttempts: 0 })
    ).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'invalid-options'
    });
  });

  it('rejects negative maxAttempts', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });

    await expect(
      runPlanner({ adapter, task: 'team', issue, maxAttempts: -1 })
    ).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'invalid-options'
    });
  });

  it('defaults maxAttempts to 2', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [
        { match: /.*/, output: JSON.stringify({ roles: [] }) } // always invalid
      ]
    });

    await expect(
      runPlanner({ adapter, task: 'team', issue })
    ).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'invalid-output',
      details: expect.objectContaining({ attempts: 2 })
    });
  });
});

describe('runPlanner adapter lifecycle', () => {
  it('starts an idle adapter and stops it on success', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validTeam) }]
    });
    expect((await adapter.status()).state).toBe('idle');

    await runPlanner({ adapter, task: 'team', issue });

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('starts an idle adapter and stops it on failure', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'no json at all' }]
    });

    await expect(
      runPlanner({ adapter, task: 'team', issue, maxAttempts: 1 })
    ).rejects.toMatchObject({ code: 'extract-failed' });

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('does NOT stop a caller-started adapter on success', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validTeam) }]
    });
    await adapter.start({ workingDirectory: '/tmp' });

    await runPlanner({ adapter, task: 'team', issue });

    expect((await adapter.status()).state).toBe('running');
  });

  it('does NOT stop a caller-started adapter on failure', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: 'no json' }]
    });
    await adapter.start({ workingDirectory: '/tmp' });

    await expect(
      runPlanner({ adapter, task: 'team', issue, maxAttempts: 1 })
    ).rejects.toMatchObject({ code: 'extract-failed' });

    expect((await adapter.status()).state).toBe('running');
  });

  it('starts a stopped adapter and stops it on success', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validTeam) }]
    });
    await adapter.start({ workingDirectory: '/tmp' });
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');

    await runPlanner({ adapter, task: 'team', issue });

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('throws adapter-not-ready and never sends when adapter is in an unusable state', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    let sendCalls = 0;
    const originalSend = adapter.send.bind(adapter);
    adapter.send = async (input: string) => {
      sendCalls++;
      return originalSend(input);
    };
    // Override status to simulate a transient state we can't trigger naturally.
    adapter.status = async () => ({ state: 'starting' });

    await expect(
      runPlanner({ adapter, task: 'team', issue })
    ).rejects.toMatchObject({
      name: 'PlannerError',
      code: 'adapter-not-ready'
    });
    expect(sendCalls).toBe(0);
  });
});

describe('runPlanner adapter failure wrapping', () => {
  it('wraps adapter.send rejection in PlannerError("adapter-failed", ..., { cause })', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    const boom = new Error('network down');
    adapter.send = async () => {
      throw boom;
    };

    try {
      await runPlanner({ adapter, task: 'team', issue });
      throw new Error('expected runPlanner to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerError);
      expect((err as PlannerError).code).toBe('adapter-failed');
      expect((err as PlannerError).details.cause).toBe(boom);
    }
  });

  it('cleans up an owned adapter when send rejects', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    adapter.send = async () => {
      throw new Error('boom');
    };

    await expect(
      runPlanner({ adapter, task: 'team', issue })
    ).rejects.toBeInstanceOf(PlannerError);

    expect((await adapter.status()).state).toBe('stopped');
  });

  it('wraps adapter.start rejection in PlannerError("adapter-failed", ..., { cause })', async () => {
    const adapter = new ScriptedAgentAdapter({ steps: [] });
    const boom = new Error('failed to spawn host');
    let stopCalls = 0;
    adapter.start = async () => {
      throw boom;
    };
    const originalStop = adapter.stop.bind(adapter);
    adapter.stop = async () => {
      stopCalls++;
      return originalStop();
    };

    try {
      await runPlanner({ adapter, task: 'team', issue });
      throw new Error('expected runPlanner to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerError);
      expect((err as PlannerError).code).toBe('adapter-failed');
      expect((err as PlannerError).details.cause).toBe(boom);
    }
    // start() never resolved, so the planner never took ownership; the
    // finally block must not call stop() on an unstarted adapter.
    expect(stopCalls).toBe(0);
  });
});

describe('planTeam / decomposeIssue', () => {
  it('planTeam returns the TeamDefinition directly', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validTeam) }]
    });

    const data = await planTeam({ adapter, issue });

    expect(data).toEqual(validTeam);
  });

  it('decomposeIssue returns the DecompositionPlan directly', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify(validDecomp) }]
    });

    const data = await decomposeIssue({ adapter, issue });

    expect(data).toEqual(validDecomp);
  });

  it('planTeam forwards maxAttempts', async () => {
    const adapter = new ScriptedAgentAdapter({
      steps: [{ match: /.*/, output: JSON.stringify({ roles: [] }) }]
    });

    await expect(
      planTeam({ adapter, issue, maxAttempts: 1 })
    ).rejects.toMatchObject({
      code: 'invalid-output',
      details: expect.objectContaining({ attempts: 1 })
    });
  });
});
