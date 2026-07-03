import { z } from 'zod';

import { extractJson } from '../planner/extract.js';
import type { AgentAdapter } from './types.js';
import { errorMessage, runOwnedAgentSession } from './agent-lifecycle.js';

export const reviewFindingSchema = z.object({
  severity: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string()
});

export const reviewVerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  findings: z.array(reviewFindingSchema).default([])
});

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

export interface RunReviewAgentInput {
  adapter: AgentAdapter;
  prompt: string;
  cwd: string;
  /** Hard cap on the whole review; on elapse the check fails. */
  timeoutSeconds?: number;
  /** Caller cancellation; on abort the check fails. */
  abortSignal?: AbortSignal;
}

/**
 * Runs a fresh review agent and maps its structured output to a pass/fail
 * verdict.
 *
 * ponytail: the retry-once-then-parse policy stays here (extractJson + zod
 * safeParse, one corrective follow-up) rather than sharing WITH the planner —
 * the two differ in a load-bearing way: the planner THROWS on unusable output,
 * but a review check must never throw past the gate; every failure path
 * (timeout, abort, unparseable, schema-invalid) collapses to a `fail` verdict
 * so the route stays the sole authority and never silently passes. The
 * start-if-owned / stop-in-finally lifecycle AND the abort/timeout/send plumbing
 * ARE shared with runFixerAgent via runOwnedAgentSession (agent-lifecycle.ts);
 * only the result mapping (verdict vs ok/fail) stays per-runner.
 */
export async function runReviewAgent(input: RunReviewAgentInput): Promise<ReviewVerdict> {
  const { adapter, prompt, cwd, timeoutSeconds, abortSignal } = input;

  return runOwnedAgentSession<ReviewVerdict>(
    { adapter, cwd, timeoutSeconds, abortSignal },
    async (send) => {
      let nextPrompt = prompt;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const output = await send(nextPrompt);
        const parsed = tryParseVerdict(output);
        if (parsed.ok) {
          return parsed.value;
        }
        nextPrompt = buildRetryPrompt(parsed.reason);
      }
      return failVerdict('review agent output could not be parsed as a valid verdict JSON');
    },
    () => failVerdict(abortMessage(timeoutSeconds, abortSignal)),
    (message) => failVerdict(`review agent invocation failed: ${message}`)
  );
}

function tryParseVerdict(
  output: string
): { ok: true; value: ReviewVerdict } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = extractJson(output);
  } catch (err) {
    return { ok: false, reason: `no JSON found: ${errorMessage(err)}` };
  }
  const validation = reviewVerdictSchema.safeParse(raw);
  if (validation.success) {
    return { ok: true, value: validation.data };
  }
  return { ok: false, reason: validation.error.message };
}

function buildRetryPrompt(reason: string): string {
  return [
    'Your previous response was not a valid review verdict.',
    `Problem: ${reason}`,
    '',
    'Respond with ONLY a single JSON object of the form:',
    '{ "verdict": "pass" | "fail", "findings": [ { "message": string } ] }',
    'No prose, no markdown fences.'
  ].join('\n');
}

function failVerdict(message: string): ReviewVerdict {
  return { verdict: 'fail', findings: [{ severity: 'blocker', message }] };
}

function abortMessage(
  timeoutSeconds: number | undefined,
  abortSignal: AbortSignal | undefined
): string {
  if (abortSignal?.aborted) return 'review agent aborted before returning a verdict';
  if (timeoutSeconds !== undefined) {
    return `review agent timed out after ${timeoutSeconds}s before returning a verdict`;
  }
  return 'review agent aborted before returning a verdict';
}
