import { slugify } from '../core/slug.js';

export function slugifyRoleName(name: string): string {
  return slugify(name);
}

export function buildAgentId(issueNumber: number, roleName: string, instanceIndex: number): string {
  return `agent-${issueNumber}-${slugifyRoleName(roleName)}-${instanceIndex}`;
}
