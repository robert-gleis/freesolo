import { describe, expect, it } from 'vitest';

import { ScriptedAgentAdapter } from '../../src/agents/scripted.js';
import { runPlanner } from '../../src/planner/runtime.js';
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
