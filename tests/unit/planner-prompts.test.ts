import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildTeamPrompt } from '../../src/planner/prompts/team.js';
import { buildDecompositionPrompt } from '../../src/planner/prompts/decomposition.js';
import { buildRetryPrompt } from '../../src/planner/prompts/retry.js';
import { PLANNER_HOSTS, teamDefinitionSchema } from '../../src/planner/schemas/team-definition.js';
import { decompositionPlanSchema } from '../../src/planner/schemas/decomposition-plan.js';
import type { PlannerIssue } from '../../src/planner/types.js';

const issue: PlannerIssue = {
  number: 42,
  title: 'Add caching layer to API',
  body: 'We need a Redis-backed cache in front of the issues endpoint.',
  labels: ['enhancement', 'backend']
};

describe('buildTeamPrompt', () => {
  const prompt = buildTeamPrompt(issue);

  it('includes the issue number', () => {
    expect(prompt).toContain('42');
  });

  it('includes the issue title', () => {
    expect(prompt).toContain('Add caching layer to API');
  });

  it('includes the issue body', () => {
    expect(prompt).toContain('Redis-backed cache in front of the issues endpoint');
  });

  it('includes the issue labels when present', () => {
    expect(prompt).toContain('enhancement');
    expect(prompt).toContain('backend');
  });

  it('omits the labels section when no labels are present', () => {
    const noLabels = buildTeamPrompt({ ...issue, labels: undefined });
    expect(noLabels).not.toMatch(/labels:/i);
  });

  it('mentions JSON and schema in the output contract', () => {
    expect(prompt).toContain('JSON');
    expect(prompt.toLowerCase()).toContain('schema');
  });

  it('mentions every TeamDefinition role field in the prompt body', () => {
    const teamRoleShape = Object.keys(
      teamDefinitionSchema.shape.roles.element.shape
    );
    for (const field of teamRoleShape) {
      expect(prompt).toContain(field);
    }
  });

  it('includes every PLANNER_HOSTS value in the prompt', () => {
    for (const host of PLANNER_HOSTS) {
      expect(prompt).toContain(host);
    }
  });
});

describe('buildDecompositionPrompt', () => {
  const prompt = buildDecompositionPrompt(issue);

  it('includes the issue number', () => {
    expect(prompt).toContain('42');
  });

  it('includes the issue title', () => {
    expect(prompt).toContain('Add caching layer to API');
  });

  it('includes the issue body', () => {
    expect(prompt).toContain('Redis-backed cache');
  });

  it('mentions JSON and schema in the output contract', () => {
    expect(prompt).toContain('JSON');
    expect(prompt.toLowerCase()).toContain('schema');
  });

  it('mentions every DecompositionPlan top-level field', () => {
    const topLevel = Object.keys(decompositionPlanSchema.shape);
    for (const field of topLevel) {
      expect(prompt).toContain(field);
    }
  });

  it('mentions every ChildIssue field', () => {
    const childFields = Object.keys(
      decompositionPlanSchema.shape.children.element.shape
    );
    for (const field of childFields) {
      expect(prompt).toContain(field);
    }
  });
});

describe('buildRetryPrompt', () => {
  const schema = z.object({ x: z.string() });
  const failingResult = schema.safeParse({ x: 123 });
  if (failingResult.success) throw new Error('expected schema to reject');
  const prompt = buildRetryPrompt(failingResult.error);

  it('signals that the previous response was wrong', () => {
    expect(prompt.toLowerCase()).toContain('previous response');
  });

  it('embeds the formatted zod error', () => {
    // The formatted error should mention the field name or expected type.
    expect(prompt.toLowerCase()).toMatch(/x|expected|string/);
  });

  it('asks for a JSON object only, no explanations', () => {
    expect(prompt).toContain('JSON');
    expect(prompt.toLowerCase()).toMatch(/no explanations|no markdown/);
  });
});
