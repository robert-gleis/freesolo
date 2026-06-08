import type { TeamMemberSpec } from './types.js';

export function buildMemberPrompt(member: TeamMemberSpec, issueNumber: number): string {
  return [
    `You are team member "${member.memberId}" on issue #${issueNumber}.`,
    `Role: ${member.roleName}`,
    `Responsibility: ${member.responsibility}`,
    'Report progress as you work.'
  ].join('\n');
}
