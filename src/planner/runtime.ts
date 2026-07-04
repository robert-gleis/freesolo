import type { z } from 'zod';

import { errorMessage } from '../core/errors.js';
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

  const initialStatus = await adapter.status();
  if (
    initialStatus.state !== 'idle' &&
    initialStatus.state !== 'stopped' &&
    initialStatus.state !== 'running'
  ) {
    throw new PlannerError(
      'adapter-not-ready',
      `adapter is in state "${initialStatus.state}", expected one of idle, stopped, running`
    );
  }
  const shouldStart =
    initialStatus.state === 'idle' || initialStatus.state === 'stopped';

  let plannerOwnsAdapter = false;

  const stopIfOwned = async (): Promise<void> => {
    if (plannerOwnsAdapter) {
      try {
        await adapter.stop();
      } catch {
        // best-effort: planner never re-throws stop failures over the primary outcome
      }
    }
  };

  try {
    if (shouldStart) {
      // start() lives inside the try so a rejection is wrapped into
      // PlannerError('adapter-failed', ...). plannerOwnsAdapter is only set
      // AFTER start resolves so the finally never tries to stop something
      // that never started.
      await adapter.start({ workingDirectory: opts.workingDirectory ?? '.' });
      plannerOwnsAdapter = true;
    }

    const schema = schemaForTask(task);
    let nextPrompt = buildPromptForTask(task, issue);
    let lastValidationError: import('zod').ZodError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const { output } = await adapter.send(nextPrompt);
      const parsed = extractJson(output);
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
  } catch (err) {
    // Thin pass: PlannerError flows through untouched. Anything else came
    // from adapter.start, adapter.send, or extractJson and gets wrapped.
    if (err instanceof PlannerError) throw err;
    throw new PlannerError('adapter-failed', errorMessage(err), { cause: err });
  } finally {
    // Single point of cleanup for every exit path (success, PlannerError,
    // wrapped adapter failure). stopIfOwned is a no-op when start never ran
    // or when the adapter was caller-started.
    await stopIfOwned();
  }
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

export async function planTeam(
  opts: Omit<PlannerOptions, 'task'>
): Promise<TeamDefinition> {
  const result = await runPlanner({ ...opts, task: 'team' });
  if (result.task !== 'team') {
    // Unreachable — defensive narrowing.
    throw new PlannerError('invalid-options', 'unexpected planner result for task=team');
  }
  return result.data;
}

export async function decomposeIssue(
  opts: Omit<PlannerOptions, 'task'>
): Promise<DecompositionPlan> {
  const result = await runPlanner({ ...opts, task: 'decomposition' });
  if (result.task !== 'decomposition') {
    throw new PlannerError(
      'invalid-options',
      'unexpected planner result for task=decomposition'
    );
  }
  return result.data;
}
