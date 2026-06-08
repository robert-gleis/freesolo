export function slugifyRoleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

export function buildAgentId(issueNumber: number, roleName: string, instanceIndex: number): string {
  return `agent-${issueNumber}-${slugifyRoleName(roleName)}-${instanceIndex}`;
}
