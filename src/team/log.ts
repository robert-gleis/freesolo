import type { TeamAgentSpawnSpec } from './types.js';

export function formatAgentSpawnLog(spec: TeamAgentSpawnSpec): string {
  const { agentId, role, workingDirectory } = spec;
  return `[issueflow] spawn agent=${agentId} role="${role.roleName}" host=${role.host} instance=${role.instanceIndex}/${role.instanceCount} cwd=${workingDirectory}`;
}
