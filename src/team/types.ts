import type { PlannerHost } from '../planner/schemas/team-definition.js';

export interface AgentRoleAssignment {
  roleName: string;
  responsibility: string;
  host: PlannerHost;
  instanceIndex: number;
  instanceCount: number;
}

export interface TeamAgentSpawnSpec {
  agentId: string;
  role: AgentRoleAssignment;
  workingDirectory: string;
  baseInstructions: string;
}

export interface RoleContextProfile {
  roleName: string;
  knowledgeInclude?: string[];
}
