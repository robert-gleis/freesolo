import { describe, expect, it } from 'vitest';

import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';
import { expandTeamPlan } from '../../src/team/expand.js';

const definition: TeamDefinition = {
  roles: [
    {
      name: 'Backend Engineer',
      host: 'cursor',
      responsibility: 'API work',
      count: 2
    },
    {
      name: 'QA',
      host: 'claude',
      responsibility: 'Test coverage',
      count: 1
    }
  ]
};

describe('expandTeamPlan', () => {
  it('emits a single spec for count 1 with instanceIndex 1 and instanceCount 1', () => {
    const specs = expandTeamPlan(
      { roles: [{ name: 'Engineer', host: 'cursor', responsibility: 'Ship', count: 1 }] },
      { issueNumber: 7, workingDirectory: '/wt', baseInstructions: 'go' }
    );
    expect(specs).toHaveLength(1);
    expect(specs[0]?.role.instanceIndex).toBe(1);
    expect(specs[0]?.role.instanceCount).toBe(1);
    expect(specs[0]?.agentId).toBe('agent-7-engineer-1');
  });

  it('emits one spec per role instance with stable agent IDs', () => {
    const specs = expandTeamPlan(definition, {
      issueNumber: 42,
      workingDirectory: '/wt',
      baseInstructions: 'go'
    });

    expect(specs).toHaveLength(3);
    expect(specs[0]?.agentId).toBe('agent-42-backend-engineer-1');
    expect(specs[1]?.agentId).toBe('agent-42-backend-engineer-2');
    expect(specs[2]?.agentId).toBe('agent-42-qa-1');
    expect(specs[0]?.role.instanceIndex).toBe(1);
    expect(specs[1]?.role.instanceCount).toBe(2);
    expect(specs.every((s) => s.workingDirectory === '/wt' && s.baseInstructions === 'go')).toBe(
      true
    );
  });
});
