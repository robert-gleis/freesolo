import { PlannerError } from './errors.js';

const FENCE_REGEX = /```(?:json)?\s*([\s\S]*?)\s*```/;

export function extractJson(output: string): unknown {
  const trimmed = output.trim();

  const direct = tryParse(trimmed);
  if (direct.ok) return direct.value;

  const fenceMatch = trimmed.match(FENCE_REGEX);
  if (fenceMatch) {
    const fenced = tryParse(fenceMatch[1]);
    if (fenced.ok) return fenced.value;
    throw new PlannerError(
      'extract-failed',
      'fenced JSON block could not be parsed',
      { snippet: trimmed.slice(0, 500) }
    );
  }

  const braceCandidate = extractBalancedObject(trimmed);
  if (braceCandidate !== null) {
    const parsed = tryParse(braceCandidate);
    if (parsed.ok) return parsed.value;
  }

  throw new PlannerError('extract-failed', 'no JSON found in output', {
    snippet: trimmed.slice(0, 500)
  });
}

function tryParse(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) };
  } catch {
    return { ok: false };
  }
}

function extractBalancedObject(input: string): string | null {
  const start = input.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return input.slice(start, i + 1);
      }
    }
  }

  return null;
}
