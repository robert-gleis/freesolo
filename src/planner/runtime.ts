import type { z } from 'zod';

import { PlannerError } from './errors.js';
import { extractJson } from './extract.js';
import { buildDecompositionPrompt } from './prompts/decomposition.js';
import { buildRetryPrompt } from './prompts/retry.js';
import { buildTeamPrompt } from './prompts/team.js';
import {
  decompositionPlanSchema,
  type DecompositionPlan
} from './schemas/decomposition-plan.js';
import {
  teamDefinitionSchema,
  type TeamDefinition
} from './schemas/team-definition.js';
import type {
  PlannerIssue,
  PlannerOptions,
  PlannerResult,
  PlannerTask
} from './types.js';

export async function runPlanner(opts: PlannerOptions): Promise<PlannerResult> {
  const { adapter, task, issue } = opts;
  const maxAttempts = opts.maxAttempts ?? 2;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new PlannerError(
      'invalid-options',
      `maxAttempts must be a positive integer, got ${maxAttempts}`
    );
  }

  const status = await adapter.status();
  if (status.state === 'idle' || status.state === 'stopped') {
    await adapter.start({ workingDirectory: opts.workingDirectory ?? '.' });
  }

  const schema = schemaForTask(task);
  let nextPrompt = buildPromptForTask(task, issue);
  let lastValidationError: import('zod').ZodError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { output } = await adapter.send(nextPrompt);
    const parsed = extractJson(output); // throws extract-failed, no retry
    const validation = schema.safeParse(parsed);
    if (validation.success) {
      return wrapResult(task, validation.data);
    }
    lastValidationError = validation.error;
    if (attempt < maxAttempts) {
      nextPrompt = buildRetryPrompt(validation.error);
    }
  }

  throw new PlannerError(
    'invalid-output',
    'planner output failed schema validation',
    { lastValidationError, attempts: maxAttempts }
  );
}

function buildPromptForTask(task: PlannerTask, issue: PlannerIssue): string {
  if (task === 'team') return buildTeamPrompt(issue);
  return buildDecompositionPrompt(issue);
}

function schemaForTask(task: PlannerTask): z.ZodType<TeamDefinition | DecompositionPlan> {
  // Cast at the return site: `ZodType` can be invariant through internal _def
  // members in some Zod 4 configurations. The runtime check happens via
  // safeParse + wrapResult, so the cast is sound.
  if (task === 'team') return teamDefinitionSchema as z.ZodType<TeamDefinition | DecompositionPlan>;
  return decompositionPlanSchema as z.ZodType<TeamDefinition | DecompositionPlan>;
}

function wrapResult(task: PlannerTask, data: TeamDefinition | DecompositionPlan): PlannerResult {
  if (task === 'team') return { task: 'team', data: data as TeamDefinition };
  return { task: 'decomposition', data: data as DecompositionPlan };
}
