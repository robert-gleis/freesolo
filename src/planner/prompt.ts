export interface PlannerIssueInput {
  number: number;
  title: string;
  body: string;
}

export function buildPlannerPrompt(issue: PlannerIssueInput): string {
  return `Analyse GitHub issue #${issue.number} and produce a team definition as JSON only.

Issue title: ${issue.title}

Issue body:
${issue.body}

Return a single JSON object with this shape:
{
  "roles": [
    {
      "name": "Role name",
      "host": "pi | claude | codex | cursor",
      "responsibility": "What this role does",
      "count": 1
    }
  ]
}

Rules:
- roles must contain at least one entry
- host must be one of: pi, claude, codex, cursor
- count must be a positive integer
- Return only the JSON object, no prose`.trim();
}
