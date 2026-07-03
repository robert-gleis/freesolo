import type { AgentAdapter } from './types.js';

/**
 * Shared one-shot agent lifecycle mechanics for the Gate Route agent runners
 * (review + fixer). This module holds ONLY the semantics-neutral plumbing that
 * both runners share verbatim: combining a timeout with a caller abort signal,
 * enforcing that combined signal by racing send() against an abort, and
 * classifying abort/timeout errors. It deliberately does NOT own start/stop or
 * any result mapping, because the two runners differ there in a load-bearing
 * way (review returns a pass/fail verdict; the fixer returns ok/fail). Keeping
 * only the plumbing here unifies the duplicated mechanics without collapsing
 * those distinct result semantics.
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

export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException) return err.name === 'AbortError' || err.name === 'TimeoutError';
  if (err instanceof Error) return err.name === 'AbortError' || err.name === 'TimeoutError';
  return false;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
