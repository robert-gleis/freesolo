import { describe, expect, it } from 'vitest';

import {
  PLANNER_HOSTS,
  PlannerError,
  buildDecompositionPrompt,
  buildTeamPrompt,
  decomposeIssue,
  decompositionPlanSchema,
  extractJson,
  planTeam,
  runPlanner,
  teamDefinitionSchema
} from '../../src/planner/index.js';

describe('planner public API', () => {
  it('exports all documented symbols', () => {
    expect(typeof runPlanner).toBe('function');
    expect(typeof planTeam).toBe('function');
    expect(typeof decomposeIssue).toBe('function');
    expect(typeof buildTeamPrompt).toBe('function');
    expect(typeof buildDecompositionPrompt).toBe('function');
    expect(typeof extractJson).toBe('function');
    expect(typeof PlannerError).toBe('function');
    expect(teamDefinitionSchema).toBeDefined();
    expect(decompositionPlanSchema).toBeDefined();
    expect(Array.isArray(PLANNER_HOSTS)).toBe(true);
  });
});
