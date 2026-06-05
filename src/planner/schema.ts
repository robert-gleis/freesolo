import { z } from 'zod';

import type { TeamDefinition } from './types.js';

const agentHostSchema = z.enum(['pi', 'claude', 'codex', 'cursor']);

const teamRoleSchema = z.object({
  name: z.string().min(1),
  host: agentHostSchema,
  responsibility: z.string().min(1),
  count: z.number().int().min(1)
});

export const teamDefinitionSchema = z.object({
  roles: z.array(teamRoleSchema).min(1)
});

export class TeamPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamPlanValidationError';
  }
}

export function parseTeamDefinition(input: unknown): TeamDefinition {
  const result = teamDefinitionSchema.safeParse(input);
  if (!result.success) {
    throw new TeamPlanValidationError(result.error.message);
  }
  return result.data;
}

export function validateTeamPlanFile(contents: string): TeamDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new TeamPlanValidationError('team plan file is not valid JSON');
  }
  return parseTeamDefinition(parsed);
}
