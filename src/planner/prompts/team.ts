import type { PlannerIssue } from '../types.js';
import { PLANNER_HOSTS } from '../schemas/team-definition.js';

const hostEnum = PLANNER_HOSTS.map(h => `"${h}"`).join(' | ');

const SCHEMA_DESCRIPTION = `Schema:
{
  "roles": [
    {
      "name": string,           // human-readable role title, e.g. "Backend Engineer"
      "host": ${hostEnum},
      "responsibility": string, // one-sentence description of what this role does
      "count": integer >= 1     // how many agents of this role to spawn
    }
  ]
}
"roles" must contain at least one entry.`;

export function buildTeamPrompt(issue: PlannerIssue): string {
  const sections: string[] = [];

  sections.push('You are a planner agent for the IssueFlow factory.');
  sections.push(
    'Your job is to analyse the GitHub issue below and propose a team of agents to ship it.'
  );
  sections.push(
    'Respond with a single JSON object matching the schema below. ' +
      'Do not include explanations, prose, or markdown — JSON only.'
  );
  sections.push(SCHEMA_DESCRIPTION);
  sections.push(renderIssue(issue));

  return sections.join('\n\n');
}

function renderIssue(issue: PlannerIssue): string {
  const lines: string[] = [];
  lines.push(`Issue #${issue.number}: ${issue.title}`);
  if (issue.labels && issue.labels.length > 0) {
    lines.push(`Labels: ${issue.labels.join(', ')}`);
  }
  lines.push('');
  lines.push('Body:');
  lines.push(issue.body);
  return lines.join('\n');
}
