import { z } from 'zod';

export const PLANNER_HOSTS = ['pi', 'claude', 'codex', 'cursor'] as const;
export type PlannerHost = (typeof PLANNER_HOSTS)[number];

export const teamRoleSchema = z.object({
  name: z.string().min(1),
  host: z.enum(PLANNER_HOSTS),
  responsibility: z.string().min(1),
  count: z.number().int().min(1)
});

export const teamDefinitionSchema = z.object({
  roles: z.array(teamRoleSchema).min(1)
});

export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamDefinition = z.infer<typeof teamDefinitionSchema>;
