import type { TeamDefinition } from '../planner/schemas/team-definition.js';
import { buildAgentId } from './agent-id.js';
import type { AgentRoleAssignment, TeamAgentSpawnSpec } from './types.js';

export interface ExpandTeamPlanInput {
  issueNumber: number;
  workingDirectory: string;
  baseInstructions: string;
}

export function expandTeamPlan(
  definition: TeamDefinition,
  input: ExpandTeamPlanInput
): TeamAgentSpawnSpec[] {
  const specs: TeamAgentSpawnSpec[] = [];

  for (const teamRole of definition.roles) {
    for (let index = 1; index <= teamRole.count; index += 1) {
      const role: AgentRoleAssignment = {
        roleName: teamRole.name,
        responsibility: teamRole.responsibility,
        host: teamRole.host,
        instanceIndex: index,
        instanceCount: teamRole.count
      };
      specs.push({
        agentId: buildAgentId(input.issueNumber, teamRole.name, index),
        role,
        workingDirectory: input.workingDirectory,
        baseInstructions: input.baseInstructions
      });
    }
  }

  return specs;
}
