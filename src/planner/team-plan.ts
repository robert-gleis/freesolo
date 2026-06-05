import type { AgentAdapter } from '../agents/index.js';
import { ScriptedAgentAdapter } from '../agents/scripted.js';
import { planTeam } from './runtime.js';
import type { TeamDefinition } from './schemas/team-definition.js';
import { writeTeamPlan } from './store.js';
import type { PlannerIssue } from './types.js';

export interface RunTeamPlannerInput {
  worktreePath: string;
  issue: PlannerIssue;
  agent: AgentAdapter;
}

export interface RunTeamPlannerResult {
  definition: TeamDefinition;
  teamPlanPath: string;
}

const defaultPlannerResponse = JSON.stringify({
  roles: [
    {
      name: 'Implementer',
      host: 'cursor',
      responsibility: 'Implement the issue according to the approved spec',
      count: 1
    }
  ]
});

export function createDefaultPlannerAgent(issue: PlannerIssue): ScriptedAgentAdapter {
  return new ScriptedAgentAdapter({
    steps: [{ match: /.*/, output: defaultPlannerResponse }]
  });
}

export async function runTeamPlanner(input: RunTeamPlannerInput): Promise<RunTeamPlannerResult> {
  const definition = await planTeam({
    adapter: input.agent,
    issue: input.issue,
    workingDirectory: input.worktreePath
  });
  const teamPlanPath = await writeTeamPlan(input.worktreePath, definition);
  return { definition, teamPlanPath };
}
