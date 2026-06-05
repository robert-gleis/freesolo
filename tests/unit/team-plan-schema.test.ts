import { describe, expect, it } from 'vitest';

import { parseTeamDefinition, TeamPlanValidationError, validateTeamPlanFile } from '../../src/planner/schema.js';

const valid = {
  roles: [
    {
      name: 'Backend Engineer',
      host: 'cursor',
      responsibility: 'Implement API endpoints',
      count: 1
    }
  ]
};

describe('parseTeamDefinition', () => {
  it('accepts a valid team definition', () => {
    expect(parseTeamDefinition(valid)).toEqual(valid);
  });

  it('rejects empty roles array', () => {
    expect(() => parseTeamDefinition({ roles: [] })).toThrow(TeamPlanValidationError);
  });

  it('rejects invalid host', () => {
    expect(() =>
      parseTeamDefinition({
        roles: [{ name: 'X', host: 'gpt', responsibility: 'y', count: 1 }]
      })
    ).toThrow(TeamPlanValidationError);
  });

  it('rejects zero count', () => {
    expect(() =>
      parseTeamDefinition({
        roles: [{ name: 'X', host: 'pi', responsibility: 'y', count: 0 }]
      })
    ).toThrow(TeamPlanValidationError);
  });

  it('rejects empty name', () => {
    expect(() =>
      parseTeamDefinition({
        roles: [{ name: '', host: 'pi', responsibility: 'y', count: 1 }]
      })
    ).toThrow(TeamPlanValidationError);
  });

  it('rejects empty responsibility', () => {
    expect(() =>
      parseTeamDefinition({
        roles: [{ name: 'X', host: 'pi', responsibility: '', count: 1 }]
      })
    ).toThrow(TeamPlanValidationError);
  });
});

describe('validateTeamPlanFile', () => {
  it('parses JSON string then validates', () => {
    expect(validateTeamPlanFile(JSON.stringify(valid))).toEqual(valid);
  });

  it('throws TeamPlanValidationError on invalid JSON', () => {
    expect(() => validateTeamPlanFile('not json')).toThrow(TeamPlanValidationError);
  });
});
