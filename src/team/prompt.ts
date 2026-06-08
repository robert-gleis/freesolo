import type { AgentRoleAssignment } from './types.js';

export function buildRolePrompt(role: AgentRoleAssignment, baseInstructions: string): string {
  const title =
    role.instanceCount > 1
      ? `**${role.roleName}** (${role.instanceIndex}/${role.instanceCount})`
      : `**${role.roleName}**`;

  return [
    '## Your Role',
    '',
    `You are the ${title} on this issue's team.`,
    '',
    `**Responsibility:** ${role.responsibility}`,
    '',
    'Stay within your role scope. Coordinate through shared issue artifacts and the worktree.',
    '',
    '---',
    '',
    baseInstructions
  ].join('\n');
}
