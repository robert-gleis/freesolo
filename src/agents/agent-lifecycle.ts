import type { AgentAdapter } from './types.js';

/**
 * Shared one-shot agent lifecycle for the Gate Route agent runners (review +
 * fixer). This module owns BOTH the semantics-neutral plumbing (combine a
 * timeout with a caller abort signal, race send() against that signal, classify
 * abort/timeout errors) AND the ownership skeleton around it
 * ({@link runOwnedAgentSession}: status->start-if-owned, run the caller's work,
 * classify abort vs error, stop the owned adapter in finally). It deliberately
 * does NOT own result mapping, because the two runners differ there in a
 * load-bearing way (review returns a pass/fail verdict; the fixer returns
 * ok/fail). Callers inject that mapping via `work`/`onAbort`/`onError` so the
 * lifecycle stops being duplicated while the distinct result semantics stay
 * per-runner.
 */

/** Combines a timeout signal with an optional caller signal. */
export function buildAgentSignal(
  timeoutSeconds: number | undefined,
  abortSignal: AbortSignal | undefined
): AbortSignal | undefined {
  const timeout =
    timeoutSeconds === undefined ? undefined : AbortSignal.timeout(timeoutSeconds * 1000);
  if (timeout && abortSignal) return AbortSignal.any([abortSignal, timeout]);
  return timeout ?? abortSignal;
}

/**
 * The AgentAdapter protocol has no built-in cancellation, so enforce the
 * combined signal by racing send() against an abort. A losing send() keeps
 * running to completion in the background; the caller stops the owned adapter in
 * a finally block regardless.
 */
export async function sendWithSignal(
  adapter: AgentAdapter,
  prompt: string,
  signal: AbortSignal | undefined
): Promise<string> {
  if (!signal) {
    const { output } = await adapter.send(prompt);
    return output;
  }
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  }
  return new Promise<string>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    adapter.send(prompt).then(
      ({ output }) => {
        signal.removeEventListener('abort', onAbort);
        resolve(output);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}

export interface OwnedAgentSession {
  adapter: AgentAdapter;
  cwd: string;
  /** Hard cap on the whole session; on elapse the caller's onAbort maps it. */
  timeoutSeconds?: number;
  /** Caller cancellation; on abort the caller's onAbort maps it. */
  abortSignal?: AbortSignal;
}

/** Sends `prompt`, racing against the session's combined abort/timeout signal. */
export type SessionSend = (prompt: string) => Promise<string>;

/**
 * Runs `work` inside a one-shot owned-agent session: reads status and starts the
 * adapter iff it was idle/stopped (tracking ownership), builds the combined
 * abort/timeout signal, invokes `work` with a `send` bound to that signal,
 * classifies any thrown error as abort (-> onAbort) vs other (-> onError), and
 * stops the owned adapter in a finally block — never letting a stop() failure
 * override the result. The result mapping stays with the caller (review maps to
 * a verdict; the fixer maps to ok/fail), so only this lifecycle is shared.
 */
export async function runOwnedAgentSession<T>(
  session: OwnedAgentSession,
  work: (send: SessionSend) => Promise<T>,
  onAbort: (message: string) => T,
  onError: (message: string) => T
): Promise<T> {
  const { adapter, cwd } = session;

  let ownsAdapter = false;

  const signal = buildAgentSignal(session.timeoutSeconds, session.abortSignal);
  const send: SessionSend = (prompt) => sendWithSignal(adapter, prompt, signal);

  try {
    // Inside the try so a status() failure is classified as onError like any
    // other adapter error, rather than propagating unhandled.
    const status = await adapter.status();
    const shouldStart = status.state === 'idle' || status.state === 'stopped';
    if (shouldStart) {
      await adapter.start({ workingDirectory: cwd });
      ownsAdapter = true;
    }

    return await work(send);
  } catch (err) {
    if (isAbortError(err)) {
      return onAbort(abortMessage(session.timeoutSeconds, session.abortSignal));
    }
    return onError(errorMessage(err));
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
  if (abortSignal?.aborted) return 'aborted before completing';
  if (timeoutSeconds !== undefined) {
    return `timed out after ${timeoutSeconds}s before completing`;
  }
  return 'aborted before completing';
}

export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError' || err.name === 'TimeoutError';
  if (err instanceof Error) return err.name === 'AbortError' || err.name === 'TimeoutError';
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
