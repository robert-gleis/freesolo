import type { PlannerHost } from '../planner/schemas/team-definition.js';
import { buildAgentId } from './agent-id.js';
import { formatAgentSpawnLog } from './log.js';
import { buildRolePrompt } from './prompt.js';
import type { AgentRoleAssignment, TeamAgentSpawnSpec } from './types.js';

export function buildDefaultImplementerRole(host: PlannerHost): AgentRoleAssignment {
  return {
    roleName: 'Implementer',
    responsibility: 'Execute the issueflow workflow for this issue',
    host,
    instanceIndex: 1,
    instanceCount: 1
  };
}

export interface PrepareAgentSpawnInput {
  agentId?: string;
  issueNumber: number;
  role: AgentRoleAssignment;
  workingDirectory: string;
  baseInstructions: string;
}

export interface PrepareAgentSpawnResult {
  agentId: string;
  role: AgentRoleAssignment;
  instructions: string;
  logLine: string;
  eventPayload: Record<string, unknown>;
}

export function buildAgentStoppedPayload(role: AgentRoleAssignment): Record<string, unknown> {
  return { roleName: role.roleName };
}

export function prepareAgentSpawn(input: PrepareAgentSpawnInput): PrepareAgentSpawnResult {
  const agentId =
    input.agentId ?? buildAgentId(input.issueNumber, input.role.roleName, input.role.instanceIndex);
  const spec: TeamAgentSpawnSpec = {
    agentId,
    role: input.role,
    workingDirectory: input.workingDirectory,
    baseInstructions: input.baseInstructions
  };
  const instructions = buildRolePrompt(input.role, input.baseInstructions);
  const eventPayload = {
    roleName: input.role.roleName,
    responsibility: input.role.responsibility,
    host: input.role.host,
    instanceIndex: input.role.instanceIndex,
    instanceCount: input.role.instanceCount,
    workingDirectory: input.workingDirectory
  };

  return {
    agentId,
    role: input.role,
    instructions,
    logLine: formatAgentSpawnLog(spec),
    eventPayload
  };
}
