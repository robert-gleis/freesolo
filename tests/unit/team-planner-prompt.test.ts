import { describe, expect, it } from 'vitest';

import { buildPlannerPrompt } from '../../src/planner/prompt.js';

describe('buildPlannerPrompt', () => {
  it('includes issue number, title, and body', () => {
    const prompt = buildPlannerPrompt({
      number: 34,
      title: 'Team Planner',
      body: 'Build the planner module'
    });

    expect(prompt).toContain('#34');
    expect(prompt).toContain('Team Planner');
    expect(prompt).toContain('Build the planner module');
    expect(prompt).toContain('"roles"');
    expect(prompt).toContain('pi | claude | codex | cursor');
  });
});
