import { describe, expect, it } from 'vitest';

import { HOST_TOOLS } from '../../src/core/types.js';
import { PLANNER_HOSTS } from '../../src/planner/schemas/team-definition.js';

describe('host enum consistency', () => {
  it('HOST_TOOLS contains exactly the three current launchable hosts', () => {
    expect([...HOST_TOOLS]).toEqual(['codex', 'claude', 'cursor']);
  });

  it('every HostTool value is also a valid PlannerHost', () => {
    const plannerHosts = new Set<string>(PLANNER_HOSTS);

    for (const host of HOST_TOOLS) {
      expect(plannerHosts.has(host)).toBe(true);
    }
  });

  it('PLANNER_HOSTS may be a superset (allowed by design)', () => {
    // PLANNER_HOSTS includes 'pi' which is not yet in HOST_TOOLS — that is intentional.
    // The forward containment is what the planner needs to guarantee.
    expect(PLANNER_HOSTS.length).toBeGreaterThanOrEqual(HOST_TOOLS.length);
  });
});
