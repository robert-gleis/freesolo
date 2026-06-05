import fs from 'node:fs/promises';
import path from 'node:path';

import { getIssueflowPath } from '../core/session-state.js';
import { validateTeamPlanFile } from './schema.js';
import type { TeamDefinition } from './types.js';

export class TeamPlanNotFoundError extends Error {
  constructor(planPath: string) {
    super(`team plan not found: ${planPath}`);
    this.name = 'TeamPlanNotFoundError';
  }
}

export async function getTeamPlanPath(worktreePath: string): Promise<string> {
  const rawPath = await getIssueflowPath(worktreePath, 'team-plan.json');
  return path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath);
}

export async function writeTeamPlan(worktreePath: string, definition: TeamDefinition): Promise<string> {
  const teamPlanPath = await getTeamPlanPath(worktreePath);
  await fs.mkdir(path.dirname(teamPlanPath), { recursive: true });
  await fs.writeFile(teamPlanPath, `${JSON.stringify(definition, null, 2)}\n`);
  return teamPlanPath;
}

export async function readTeamPlan(worktreePath: string): Promise<TeamDefinition> {
  const teamPlanPath = await getTeamPlanPath(worktreePath);
  let contents: string;
  try {
    contents = await fs.readFile(teamPlanPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TeamPlanNotFoundError(teamPlanPath);
    }
    throw error;
  }
  return validateTeamPlanFile(contents);
}
