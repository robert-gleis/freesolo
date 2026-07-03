import type { AgentAdapter } from './types.js';
import {
  buildAgentSignal,
  errorMessage,
  isAbortError,
  sendWithSignal
} from './agent-lifecycle.js';

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
 * ponytail: mirrors runReviewAgent's start-if-owned / stop-in-finally lifecycle
 * and reuses the shared abort/timeout plumbing (agent-lifecycle.ts). It does NOT
 * share a result mapper with review because the semantics differ: review maps
 * output to a pass/fail verdict; the fixer only cares that the process completed.
 */
export async function runFixerAgent(input: RunFixerAgentInput): Promise<FixerAgentResult> {
  const { adapter, prompt, cwd } = input;

  const status = await adapter.status();
  const shouldStart = status.state === 'idle' || status.state === 'stopped';
  let ownsAdapter = false;

  const signal = buildAgentSignal(input.timeoutSeconds, input.abortSignal);

  try {
    if (shouldStart) {
      await adapter.start({ workingDirectory: cwd });
      ownsAdapter = true;
    }

    const output = await sendWithSignal(adapter, prompt, signal);
    return { ok: true, detail: 'fixer agent completed', output };
  } catch (err) {
    if (isAbortError(err)) {
      return { ok: false, detail: abortMessage(input.timeoutSeconds, input.abortSignal) };
    }
    return { ok: false, detail: `fixer agent invocation failed: ${errorMessage(err)}` };
  } finally {
    if (ownsAdapter) {
      try {
        await adapter.stop();
      } catch {
        // best-effort: never let a stop failure override the result
      }
    }
  }
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
