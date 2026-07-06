# Plan Review Round 5 — Issue #20 (final round)

## Status
pass

## Summary
The plan is implementation-ready. Scope is correctly bounded to the verification pipeline (no PR-blocking, no reviewer-artifact generation, no auto-detection). All spec acceptance criteria (configurable checks, structured per-check pass/fail with logs, deterministic re-runnable runs, persistence keyed by issue id) map to specific tasks and tests. Type names, fixtures, DI seams, ESM `.js` imports, zod 4 idioms, execa 9 streaming, and the SIGINT/abort contract are internally consistent and consistent with the existing codebase (`start.ts`, `session-state.ts`, `cli.ts`). Each task follows a strict failing-test → implementation → passing-test → commit loop with complete code, and the Self-Review Notes accurately track which behaviours are locked by which tests. The three round-4 findings are all resolved with explicit locking tests.

## Findings
None.

## Notes
- Round-4 finding 1 (per-check `catch` race between two file descriptors) is resolved: the synthetic error line now `await writeQueue` then writes through the same open `handle`, locked by the new `'preserves pre-throw chunks and appends the synthetic error to the same log'` runner test.
- Round-4 finding 2 (runner-test `now()` fixture overflowing after 10 ticks) is resolved: `makeMonotonicNow()` uses `baseMs + tick*1000`, applied uniformly across the runner suite.
- Round-4 finding 3 (`NEVER_ABORT` module singleton accumulating listeners) is resolved: `RunPipelineDeps.execCheck` now takes `abortSignal: AbortSignal | undefined`, and the default `execCheck` only attaches/removes the abort listener when a signal is actually provided.
- The default `execCheck` correctly forwards execa's `exitCode`/`signal` from a rejected promise into the `CheckResult`, so a SIGINT-via-throw path still produces `signal: 'SIGINT'` and drives the exit-code-130 mapping. Locked by `'records a real ENOENT failure with the message in the log (default deps)'`.
- The runner is the single owner of on-disk artefacts for a run (logs and `run.json`), with `writeRun` retained in `store.ts` only for future readers; the Self-Review Notes call this out so future contributors don't mistakenly wire it into the pipeline.
- Integration test uses `process.stdout.write(..., () => process.exit(N))` to avoid the stdout-drain race that bare `console.log + process.exit` can hit — appropriate for a real-subprocess test.
- `--issue abc` flows through `parseInt → NaN` and is rejected by the resolver's `Number.isInteger` guard with exit code 2; the error message is correct but slightly terse. Not blocking — can be polished during implementation if there's time.
- The `verifyAction` SIGINT listener (one-shot `process.once('SIGINT', ...)` inside a try/finally) is intentionally not directly unit-tested; the behavioural contract is covered through `createVerifyPlan(input, deps)` with `abortSignal` injected. This trade-off is explicitly documented in the Self-Review Notes.
