import type { PlannerIssue } from '../types.js';

const SCHEMA_DESCRIPTION = `Schema:
{
  "parent_issue": integer > 0,
  "children": [
    {
      "title": string,
      "body":  string,            // include "## Parent\\n\\n#<parent_issue>" so the link is recorded
      "labels": string[]          // may be empty
    }
  ]
}
"children" must contain at least one entry.`;

export function buildDecompositionPrompt(issue: PlannerIssue): string {
  const sections: string[] = [];

  sections.push('You are a planner agent for the IssueFlow factory.');
  sections.push(
    'Your job is to decompose the GitHub issue below into smaller, independently-executable child issues.'
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
