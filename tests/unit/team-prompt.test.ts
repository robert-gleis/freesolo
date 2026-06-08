import { describe, expect, it } from 'vitest';

import { buildRolePrompt } from '../../src/team/prompt.js';
import type { AgentRoleAssignment } from '../../src/team/types.js';

const singleRole: AgentRoleAssignment = {
  roleName: 'Backend Engineer',
  responsibility: 'Implement API endpoints',
  host: 'cursor',
  instanceIndex: 1,
  instanceCount: 1
};

describe('buildRolePrompt', () => {
  it('prepends a role section before base instructions', () => {
    const result = buildRolePrompt(singleRole, 'do the work');
    expect(result).toContain('## Your Role');
    expect(result).toContain('**Backend Engineer**');
    expect(result).not.toContain('(1/1)');
    expect(result).toContain('**Responsibility:** Implement API endpoints');
    expect(result.endsWith('do the work')).toBe(true);
  });

  it('includes instance suffix when count > 1', () => {
    const role: AgentRoleAssignment = { ...singleRole, instanceIndex: 2, instanceCount: 3 };
    expect(buildRolePrompt(role, 'base')).toContain('**Backend Engineer** (2/3)');
  });
});
