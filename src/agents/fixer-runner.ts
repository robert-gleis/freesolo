import type { AgentAdapter } from './types.js';
import { runOwnedAgentSession } from './agent-lifecycle.js';

export interface RunFixerAgentInput {
  adapter: AgentAdapter;
  prompt: string;
  cwd: string;
  /** Hard cap on the whole fix; on elapse the fixer fails (and the route fails). */
  timeoutSeconds?: number;
  /** Caller cancellation; on abort the fixer fails. */
  abortSignal?: AbortSignal;
}

export interface FixerAgentResult {
  ok: boolean;
  detail: string;
  /** The agent's final output, when it completed normally. */
  output?: string;
}

/**
 * Runs a fresh Fixer Agent one-shot. The fixer may change code; it does NOT
 * decide route success. Completion is the only signal we read here:
 *
 * - `ok: true`  when adapter.send resolves normally (the agent finished).
 * - `ok: false` on adapter error, timeout, or abort.
 *
 * There is deliberately no verdict/JSON requirement — the subsequent COMPLETE
 * route rerun (route-runner) is the sole arbiter of whether the fix worked.
 *
 * ponytail: shares the start-if-owned / stop-in-finally lifecycle AND the
 * abort/timeout plumbing with runReviewAgent via runOwnedAgentSession
 * (agent-lifecycle.ts). Only the result mapping stays here, because the
 * semantics differ: review maps output to a pass/fail verdict; the fixer only
 * cares that the process completed (ok/fail).
 */
export async function runFixerAgent(input: RunFixerAgentInput): Promise<FixerAgentResult> {
  const { adapter, prompt, cwd, timeoutSeconds, abortSignal } = input;

  return runOwnedAgentSession<FixerAgentResult>(
    { adapter, cwd, timeoutSeconds, abortSignal },
    async (send) => {
      const output = await send(prompt);
      return { ok: true, detail: 'fixer agent completed', output };
    },
    () => ({ ok: false, detail: abortMessage(timeoutSeconds, abortSignal) }),
    (message) => ({ ok: false, detail: `fixer agent invocation failed: ${message}` })
  );
}

function abortMessage(
  timeoutSeconds: number | undefined,
  abortSignal: AbortSignal | undefined
): string {
  if (abortSignal?.aborted) return 'fixer agent aborted before completing';
  if (timeoutSeconds !== undefined) {
    return `fixer agent timed out after ${timeoutSeconds}s before completing`;
  }
  return 'fixer agent aborted before completing';
}
