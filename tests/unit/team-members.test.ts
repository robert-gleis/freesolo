import { describe, expect, it } from 'vitest';

import { expandTeamDefinition, slugRoleName } from '../../src/teams/members.js';
import { buildMemberPrompt } from '../../src/teams/prompt.js';
import { DEFAULT_TEAM_LIFECYCLE_CONFIG } from '../../src/teams/types.js';
import type { TeamDefinition } from '../../src/planner/schemas/team-definition.js';

describe('team types', () => {
  it('exports default lifecycle config', () => {
    expect(DEFAULT_TEAM_LIFECYCLE_CONFIG.pollIntervalMs).toBe(5_000);
    expect(DEFAULT_TEAM_LIFECYCLE_CONFIG.memberBlockedTimeoutMs).toBe(1_800_000);
  });
});

describe('slugRoleName', () => {
  it('lowercases and hyphenates', () => {
    expect(slugRoleName('Backend Engineer')).toBe('backend-engineer');
  });
});

describe('expandTeamDefinition', () => {
  it('flattens role counts into member specs', () => {
    const definition: TeamDefinition = {
      roles: [
        { name: 'Backend Engineer', host: 'cursor', responsibility: 'API', count: 2 },
        { name: 'QA', host: 'claude', responsibility: 'Tests', count: 1 }
      ]
    };
    const members = expandTeamDefinition(definition);
    expect(members.map((member) => member.memberId)).toEqual([
      'backend-engineer-1',
      'backend-engineer-2',
      'qa-1'
    ]);
    expect(members[0]).toMatchObject({ roleName: 'Backend Engineer', index: 1, host: 'cursor' });
  });
});

describe('buildMemberPrompt', () => {
  it('includes role, responsibility, and issue number', () => {
    const prompt = buildMemberPrompt(
      {
        memberId: 'backend-1',
        roleName: 'Backend',
        host: 'cursor',
        responsibility: 'API work',
        index: 1
      },
      41
    );
    expect(prompt).toContain('Backend');
    expect(prompt).toContain('API work');
    expect(prompt).toContain('41');
  });
});
