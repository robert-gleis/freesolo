import { TeamPlannerError } from './errors.js';

const fencedJsonPattern = /```json\s*([\s\S]*?)\s*```/i;

export function extractJsonFromAgentOutput(output: string): unknown {
  const trimmed = output.trim();
  const fenced = fencedJsonPattern.exec(trimmed);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    throw new TeamPlannerError('invalid-json', 'agent output is not valid JSON');
  }
}
