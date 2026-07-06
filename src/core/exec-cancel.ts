/**
 * Milliseconds to wait after the graceful termination signal before execa
 * escalates to SIGKILL. Overridable via FREESOLO_FORCE_KILL_MS (tests set a
 * short value). Defaults to 5s so a well-behaved child gets a chance to flush.
 *
 * Shared by every place that spawns a cancellable subprocess (verification
 * shell checks in verification/runner.ts and the host-agent invokers in
 * agents/*.ts) so the escalation window is defined exactly once. Pass the result
 * as execa's `forceKillAfterDelay` alongside `cancelSignal` so an aborted signal
 * sends SIGTERM and, if the child ignores it, escalates to SIGKILL — guaranteeing
 * the timeout truly bounds the await.
 */
export function forceKillAfterMs(): number {
  const raw = process.env.FREESOLO_FORCE_KILL_MS;
  if (raw !== undefined) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 5000;
}
