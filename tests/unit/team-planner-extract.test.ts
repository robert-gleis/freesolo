import { describe, expect, it } from 'vitest';

import { extractJsonFromAgentOutput } from '../../src/planner/extract.js';
import { TeamPlannerError } from '../../src/planner/errors.js';

const payload = { roles: [{ name: 'A', host: 'cursor', responsibility: 'B', count: 1 }] };

describe('extractJsonFromAgentOutput', () => {
  it('parses raw JSON output', () => {
    expect(extractJsonFromAgentOutput(JSON.stringify(payload))).toEqual(payload);
  });

  it('parses fenced json block', () => {
    const output = `Here is the plan:\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
    expect(extractJsonFromAgentOutput(output)).toEqual(payload);
  });

  it('throws TeamPlannerError on unparseable output', () => {
    expect(() => extractJsonFromAgentOutput('not json at all')).toThrow(TeamPlannerError);
    try {
      extractJsonFromAgentOutput('not json at all');
    } catch (error) {
      expect(error).toMatchObject({ name: 'TeamPlannerError', code: 'invalid-json' });
    }
  });
});
