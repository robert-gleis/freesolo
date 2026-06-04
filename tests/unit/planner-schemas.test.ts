import { describe, expect, it } from 'vitest';

import { PlannerError } from '../../src/planner/errors.js';
import {
  PLANNER_HOSTS,
  teamDefinitionSchema,
  teamRoleSchema
} from '../../src/planner/schemas/team-definition.js';

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
