import type { AgentAdapter } from '../agents/index.js';
import { ScriptedAgentAdapter } from '../agents/scripted.js';
import { writeDecomposition } from './decomposition-store.js';
import { PlannerError } from './errors.js';
import { decomposeIssue } from './runtime.js';
import type { DecompositionPlan } from './schemas/decomposition-plan.js';
import type { PlannerIssue } from './types.js';

export interface RunIssueDecomposerInput {
  worktreePath: string;
  issue: PlannerIssue;
  agent: AgentAdapter;
}

export interface RunIssueDecomposerResult {
  plan: DecompositionPlan;
  decompositionPath: string;
}

export function createDefaultDecompositionAgent(issue: PlannerIssue): ScriptedAgentAdapter {
  const response = JSON.stringify({
    parent_issue: issue.number,
    children: [
      {
        title: 'Implementation slice',
        body: `## Parent\n\n#${issue.number}\n\nFirst independently executable slice.`,
        labels: ['state:triaged']
      },
      {
        title: 'Verification slice',
        body: `## Parent\n\n#${issue.number}\n\nTests and verification for the epic.`,
        labels: ['state:triaged']
      }
    ]
  });
  return new ScriptedAgentAdapter({ steps: [{ match: /.*/, output: response }] });
}

export async function runIssueDecomposer(
  input: RunIssueDecomposerInput
): Promise<RunIssueDecomposerResult> {
  const plan = await decomposeIssue({
    adapter: input.agent,
    issue: input.issue,
    workingDirectory: input.worktreePath
  });
  if (plan.parent_issue !== input.issue.number) {
    throw new PlannerError(
      'invalid-output',
      `planner returned parent_issue ${plan.parent_issue}, expected ${input.issue.number}`
    );
  }
  const decompositionPath = await writeDecomposition(input.worktreePath, plan);
  return { plan, decompositionPath };
}
