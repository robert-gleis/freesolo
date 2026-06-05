import type { AgentAdapter } from '../agents/types.js';
import { AgentAdapterError } from '../agents/types.js';
import { ScriptedAgentAdapter } from '../agents/scripted.js';
import { extractJsonFromAgentOutput } from './extract.js';
import { TeamPlannerError } from './errors.js';
import { buildPlannerPrompt, type PlannerIssueInput } from './prompt.js';
import { parseTeamDefinition, TeamPlanValidationError } from './schema.js';
import { writeTeamPlan } from './store.js';
import type { TeamDefinition } from './types.js';

export { TeamPlannerError } from './errors.js';

export interface RunTeamPlannerInput {
  worktreePath: string;
  issue: PlannerIssueInput;
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

export function createDefaultPlannerAgent(issue: PlannerIssueInput): ScriptedAgentAdapter {
  const promptPrefix = `Analyse GitHub issue #${issue.number}`;
  return new ScriptedAgentAdapter({
    steps: [{ match: new RegExp(promptPrefix), output: defaultPlannerResponse }]
  });
}

export async function runTeamPlanner(input: RunTeamPlannerInput): Promise<RunTeamPlannerResult> {
  const prompt = buildPlannerPrompt(input.issue);

  try {
    await input.agent.start({ workingDirectory: input.worktreePath, initialInstructions: prompt });
    const response = await input.agent.send(prompt);
    const extracted = extractJsonFromAgentOutput(response.output);
    const definition = parseTeamDefinition(extracted);
    const teamPlanPath = await writeTeamPlan(input.worktreePath, definition);
    return { definition, teamPlanPath };
  } catch (error) {
    if (error instanceof TeamPlannerError) {
      throw error;
    }
    if (error instanceof TeamPlanValidationError) {
      throw new TeamPlannerError('validation-failed', error.message);
    }
    if (error instanceof AgentAdapterError) {
      throw new TeamPlannerError('agent-failed', error.message);
    }
    throw error;
  } finally {
    try {
      await input.agent.stop();
    } catch {
      // best-effort cleanup
    }
  }
}
