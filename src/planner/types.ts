import type { AgentAdapter } from '../agents/index.js';
import type { DecompositionPlan } from './schemas/decomposition-plan.js';
import type { TeamDefinition } from './schemas/team-definition.js';

export interface PlannerIssue {
  number: number;
  title: string;
  body: string;
  labels?: string[];
}

export type PlannerTask = 'team' | 'decomposition';

export type PlannerResult =
  | { task: 'team'; data: TeamDefinition }
  | { task: 'decomposition'; data: DecompositionPlan };

export interface PlannerOptions {
  adapter: AgentAdapter;
  task: PlannerTask;
  issue: PlannerIssue;
  maxAttempts?: number;
  workingDirectory?: string;
}
