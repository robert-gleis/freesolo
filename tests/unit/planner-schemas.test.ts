import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { PlannerError } from '../../src/planner/errors.js';
import {
  PLANNER_HOSTS,
  teamDefinitionSchema,
  teamRoleSchema
} from '../../src/planner/schemas/team-definition.js';
import {
  childIssueSchema,
  decompositionPlanSchema
} from '../../src/planner/schemas/decomposition-plan.js';

describe('PlannerError', () => {
  it('carries code, message, and default empty details', () => {
    const err = new PlannerError('invalid-options', 'bad options');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('PlannerError');
    expect(err.code).toBe('invalid-options');
    expect(err.message).toBe('bad options');
    expect(err.details).toEqual({});
  });

  it('preserves provided details', () => {
    const cause = new Error('underlying');
    const err = new PlannerError('adapter-failed', 'adapter died', { cause });

    expect(err.details.cause).toBe(cause);
  });
});

describe('teamDefinitionSchema', () => {
  const validRole = {
    name: 'Backend Engineer',
    host: 'claude' as const,
    responsibility: 'Implement API endpoints',
    count: 1
  };

  it('accepts a minimal valid TeamDefinition', () => {
    const result = teamDefinitionSchema.safeParse({ roles: [validRole] });
    expect(result.success).toBe(true);
  });

  it('accepts every PLANNER_HOSTS value', () => {
    for (const host of PLANNER_HOSTS) {
      const result = teamRoleSchema.safeParse({ ...validRole, host });
      expect(result.success).toBe(true);
    }
  });

  it('rejects empty roles array', () => {
    const result = teamDefinitionSchema.safeParse({ roles: [] });
    expect(result.success).toBe(false);
  });

  it('rejects missing roles property', () => {
    const result = teamDefinitionSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects unknown host', () => {
    const result = teamRoleSchema.safeParse({ ...validRole, host: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('rejects empty role name', () => {
    const result = teamRoleSchema.safeParse({ ...validRole, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty responsibility', () => {
    const result = teamRoleSchema.safeParse({ ...validRole, responsibility: '' });
    expect(result.success).toBe(false);
  });

  it('rejects count of 0', () => {
    const result = teamRoleSchema.safeParse({ ...validRole, count: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects fractional count', () => {
    const result = teamRoleSchema.safeParse({ ...validRole, count: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects negative count', () => {
    const result = teamRoleSchema.safeParse({ ...validRole, count: -1 });
    expect(result.success).toBe(false);
  });
});

describe('decompositionPlanSchema', () => {
  const validChild = {
    title: 'Backend',
    body: '## Parent\n\n#100\n\n...',
    labels: ['state:triaged']
  };

  it('accepts a minimal valid DecompositionPlan', () => {
    const result = decompositionPlanSchema.safeParse({
      parent_issue: 100,
      children: [validChild]
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty labels array', () => {
    const result = childIssueSchema.safeParse({ ...validChild, labels: [] });
    expect(result.success).toBe(true);
  });

  it('rejects parent_issue of 0', () => {
    const result = decompositionPlanSchema.safeParse({
      parent_issue: 0,
      children: [validChild]
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative parent_issue', () => {
    const result = decompositionPlanSchema.safeParse({
      parent_issue: -1,
      children: [validChild]
    });
    expect(result.success).toBe(false);
  });

  it('rejects fractional parent_issue', () => {
    const result = decompositionPlanSchema.safeParse({
      parent_issue: 1.5,
      children: [validChild]
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing parent_issue', () => {
    const result = decompositionPlanSchema.safeParse({ children: [validChild] });
    expect(result.success).toBe(false);
  });

  it('rejects empty children array', () => {
    const result = decompositionPlanSchema.safeParse({
      parent_issue: 100,
      children: []
    });
    expect(result.success).toBe(false);
  });

  it('rejects child with missing body', () => {
    const result = childIssueSchema.safeParse({
      title: 'A',
      labels: []
    });
    expect(result.success).toBe(false);
  });

  it('rejects child with empty title', () => {
    const result = childIssueSchema.safeParse({ ...validChild, title: '' });
    expect(result.success).toBe(false);
  });

  it('rejects child with empty body', () => {
    const result = childIssueSchema.safeParse({ ...validChild, body: '' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string label', () => {
    const result = childIssueSchema.safeParse({
      ...validChild,
      labels: [42 as unknown as string]
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty-string label', () => {
    const result = childIssueSchema.safeParse({ ...validChild, labels: [''] });
    expect(result.success).toBe(false);
  });
});

const fixturesRoot = path.resolve(process.cwd(), 'tests/fixtures/planner');

function loadJson(rel: string): unknown {
  return JSON.parse(readFileSync(path.join(fixturesRoot, rel), 'utf8'));
}

describe('schemas accept golden-input fixtures', () => {
  it('teamDefinitionSchema accepts small-bugfix.team.json', () => {
    const result = teamDefinitionSchema.safeParse(
      loadJson('outputs/small-bugfix.team.json')
    );
    expect(result.success).toBe(true);
  });

  it('teamDefinitionSchema accepts medium-feature.team.json', () => {
    const result = teamDefinitionSchema.safeParse(
      loadJson('outputs/medium-feature.team.json')
    );
    expect(result.success).toBe(true);
  });

  it('decompositionPlanSchema accepts large-epic.decomposition.json', () => {
    const result = decompositionPlanSchema.safeParse(
      loadJson('outputs/large-epic.decomposition.json')
    );
    expect(result.success).toBe(true);
  });
});
