import { slugify } from '../core/slug.js';
import type { TeamDefinition } from '../planner/schemas/team-definition.js';
import type { TeamMemberSpec } from './types.js';

export function slugRoleName(roleName: string): string {
  return slugify(roleName);
}

export function expandTeamDefinition(definition: TeamDefinition): TeamMemberSpec[] {
  const members: TeamMemberSpec[] = [];

  for (const role of definition.roles) {
    for (let index = 1; index <= role.count; index += 1) {
      members.push({
        memberId: `${slugRoleName(role.name)}-${index}`,
        roleName: role.name,
        host: role.host,
        responsibility: role.responsibility,
        index
      });
    }
  }

  return members;
}
