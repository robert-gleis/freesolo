# Plan Review Round 3 — Issue #20

## Status
pass_with_findings

## Summary
The plan is implementation-ready and tightly scoped to the verification pipeline ticket. Types, signatures, paths, and DI seams line up across the eight tasks; the runner, command, and store are cleanly separated and the test plan exercises the spec's acceptance criteria (configurability, structured results with logs, deterministic re-run, persistence keyed by issue id) plus the SIGINT/abort contract. I have two real defects to call out — both in the runner — that a fixer should address before coding. Everything else is correct as written.

## Findings

1. **Default `execCheck` swallows execa rejections it should treat as fatal.**
   - Affected: `src/verification/runner.ts` (Task 4, Step 3) — the `defaultRunPipelineDeps.execCheck` `catch` branch.
   - What's wrong: The catch returns `{ exitCode: null, signal: null }` for *any* error thrown by `await subprocess`. Because `reject: false` is set, execa will not reject for non-zero exit codes or signals — the only realistic way to reach this catch is a bona fide spawn failure (ENOENT, EPERM, EACCES, etc.) or an unexpected internal execa throw. With `signal` forced to `null`, the runner reports `status: 'fail'`, `exitCode: null`, `signal: null`, indistinguishable from a check whose handler stub returned the same. That's fine for the not-on-PATH unit test (which stubs `execCheck`), but it means in production an ENOENT failure shows up in `run.json` with no clear marker beyond the `[stderr] spawn … ENOENT\n` log line. The spec contract is "signal or error message captured in the log," which this satisfies, but the design note at plan line 1311 claims the catch "emits the error message via `onChunk('stderr', ...)`." For `subprocess.kill('SIGINT')`-driven aborts the catch path can also fire (execa surfaces it as a `SIGINT`-killed error when the process was started but the await rejects), and in that case losing the signal information is genuinely wrong: the SIGINT-aborted check will report `signal: null`, breaking the `runExitCode` heuristic that maps `check.signal === 'SIGINT'` to exit 130.
   - Why it matters: The abort-mid-flight contract (spec §"Cancelled runs", plan §"SIGINT / exit-130 contract") relies on the running check being recorded with `signal: 'SIGINT'`. The default `execCheck` is the production code path that must produce that record. With the current catch, a real Ctrl-C during a real subprocess may leave `signal: null`, falling back on the `aborted` flag in `runExitCode`. That works for `verifyAction` (which owns the controller), but `createVerifyPlan` callers who don't supply an `abortSignal` lose the 130 mapping entirely if the kill path goes through the catch.
   - Suggested fix: In the catch, inspect the error for execa's `isCanceled`/`signal`/`exitCode` fields (execa attaches these even on throws) and return them faithfully:
     ```ts
     } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
       onChunk('stderr', `${message}\n`);
       const execaError = error as { exitCode?: number | null; signal?: string | null };
       return {
         exitCode: typeof execaError.exitCode === 'number' ? execaError.exitCode : null,
         signal: typeof execaError.signal === 'string' ? execaError.signal : null
       };
     }
     ```
     A unit test using the *real* `defaultRunPipelineDeps.execCheck` against a non-existent binary would lock this in (the runner unit suite currently only stubs `execCheck`, so this code path is untested end-to-end).

2. **`runVerificationPipeline` always writes `run.json` on the success path but loses the partial run if log writing throws.**
   - Affected: `src/verification/runner.ts` (Task 4, Step 3) — the per-check `try { … } finally { await handle.close(); }` block and the final `await fs.writeFile(...run.json...)`.
   - What's wrong: Inside the per-check loop, if `await writeQueue` rejects (e.g. disk full mid-stream, or a transient EBADF), the `finally` closes the handle and the rejection propagates out of `runVerificationPipeline`. The pipeline never reaches the final `fs.writeFile(run.json, ...)`. The spec explicitly says a SIGINT-cancelled run still writes `run.json` so the partial is inspectable; the same robustness is implied for any mid-flight write failure. As written, a single noisy check that fills the disk loses the entire run record.
   - Why it matters: This contradicts plan line 1232 ("partial logs survive crashes") and the spec §"Cancelled runs" guarantee. It also means a fixer who relies on the existence of `run.json` to surface failures (e.g. the future Verification Gate ticket) will see a hard exception instead of a `'fail'` record.
   - Suggested fix: Wrap the loop body's per-check work (open handle, exec, write log, close handle) in its own `try { … } catch (error) { record a synthetic 'fail' CheckResult mentioning the error in the log, then break or continue per bail } finally { … }`, and move the `fs.writeFile(run.json, …)` into an outer `try { … } finally { … }` around the whole loop so a partial run is always persisted before the runner throws. A regression test would seed a non-writable `runDirectory` (e.g. `chmod 0o500`) or stub `fs.open` to reject, and assert `run.json` still exists with the partial result.

## Notes

- The `--issue` parser `(value) => Number.parseInt(value, 10)` will return `NaN` for non-numeric input (e.g. `--issue abc`), which `resolveIssueNumber` correctly rejects with `IssueIdError`. The user-facing message ("must be a positive integer (got NaN)") is a little awkward but not wrong — could be polished later.
- The `verifyAction` SIGINT listener is registered with `process.once('SIGINT', …)` and removed in `finally`. The Self-Review Notes at line 2312 acknowledge there is no direct unit test for that listener cleanup; the trade-off is reasonable and the SIGINT behaviour is covered behaviourally through `createVerifyPlan(input, deps)` with an injected `abortSignal`.
- `defaultDeps.readSessionFile` does not validate the JSON it reads — `JSON.parse(raw) as { issueNumber?: number }` is a cast. If `session.json` is malformed JSON, the error propagates as a raw `SyntaxError`. The CLI's `createVerifyPlan` catch handles `IssueIdError` and `VerificationConfigError` specifically; this would surface as an unhandled exception. Minor.
- The plan keeps `writeRun` exported in `src/verification/store.ts` even though `createVerifyPlan` no longer calls it (the runner persists `run.json` itself). The store unit tests still exercise it. The plan acknowledges this explicitly (Self-Review §"writeRun responsibility"). Not a blocker.
- Scope is clean. PR-blocking, reviewer-artifact generation, auto-detection, and parallel execution are all listed as non-goals or sibling tickets, and the plan does not sneak any of them in.
- The runner's log-line ordering test (`'preserves log line order under many concurrent chunks'`) and the chained `writeQueue: Promise<unknown>` design correctly address the `fs.promises.FileHandle.write` ordering caveat. Good fix.
