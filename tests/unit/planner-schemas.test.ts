import { describe, expect, it } from 'vitest';

import { PlannerError } from '../../src/planner/errors.js';

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
