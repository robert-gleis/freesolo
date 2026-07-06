# Plan Review Round 2 — Issue #36

## Verdict
pass_with_findings

## Summary
All seven major and six minor round 1 findings are addressed in the updated plan with concrete code, tests, and an expanded self-review table; two minor gaps remain — `watch run` does not log poll errors to stderr despite the round 1 recommendation, and first-run cursor is not persisted when poll finds issues but every drain fails.

## Round 1 Verification

| Round 1 finding | Status |
|---|---|
| [major] Runner poll callback does not receive computed `since` | **Fixed** — `poll: (since: string) => Promise<PollResult>`, `await deps.poll(cursor)`, tests assert expected `since` |
| [major] Task 6 omits `watch run` CLI flags | **Fixed** — `--interval` / `--trigger-label` options, merge over config, override test |
| [major] Task 6 watch command underspecified | **Fixed** — full `WatchCommandDeps`, `withCommanderErrorHandling`, `buildCycleDeps` skeleton mirroring `engine.ts` |
| [major] `watch-command.test.ts` missing env gate / exit codes | **Fixed** — tests for `run` gate (exit 3), `once` without gate, exit 1 on failures and poll errors |
| [major] No graceful SIGINT/SIGTERM shutdown | **Fixed** — `AbortSignal` on `runWatchLoop`, signal handlers in `watch run`, abort-after-cycle test |
| [major] Queue rows stuck in `processing` after crash | **Fixed** — `recoverStaleProcessing` at cycle start, store test, accepted trade-offs note |
| [major] Non-rate-limit `gh` failures silently empty | **Mostly fixed** — `PollResult.error`, runner short-circuit, `once` exit 1; **`run` logging still missing** (see new finding) |
| [minor] `FREESOLO_ENGINE` gate contradiction | **Fixed** — Accepted Design Trade-offs note + tests lock `run`-only gate |
| [minor] Missing WAL mode test | **Fixed** — `PRAGMA journal_mode` assertion in `state-db.test.ts` |
| [minor] Missing pagination warning at limit 100 | **Fixed** — `onWarn` hook, poll test, wired via `buildCycleDeps` |
| [minor] Duplicate `GhRunner` type | **Fixed** — imports from `state-store.ts` |
| [minor] Config validation omits path | **Fixed** — `validateWatcher(configPath, ...)` with path in message |
| [minor] `engines.node` version mismatch | **Fixed** — `>=22.4` in tech stack and Task 6 |
| [minor] Self-review inaccurate | **Fixed** — expanded coverage table through line 1503 |

## Findings

### [minor] `watch run` does not log poll errors despite round 1 recommendation
- **Location:** Task 5 `runWatchLoop` (plan lines 1067–1071); Task 6 `watch run` action (plan lines 1424–1430)
- **Issue:** Round 1 required non-rate-limit `gh` failures to surface to stderr on `once` (implemented via `applyCycleExitCode`) and to **log and continue** on `run`. `runWatchLoop` handles `pollError` by sleeping and continuing, but the comment "CLI writes pollError to stderr" is incorrect — neither the loop nor `watch run` calls `deps.write`. Auth or network failures during a long-running `watch run` remain invisible to the operator.
- **Recommendation:** Add an optional `onCycleResult?: (result: WatchCycleResult) => void` (or `write`) to `WatchLoopDeps`; in `watch run`, write `result.pollError` to stderr when present. Add a runner or CLI test asserting stderr output on poll error during loop.

### [minor] First-run cursor not persisted when poll finds issues but all drains fail
- **Location:** Task 5 cursor-advance logic (plan lines 1040–1045); first-run `since` default (plan line 999)
- **Issue:** When `getCursor` is null, each cycle uses `now()` as the poll baseline. If the first cycle finds issues (`enqueued > 0`) but every drain fails (`processed === 0`), neither cursor branch runs and the cursor stays null. The next cycle computes a new, later `now()`, so `updated:>SINCE` may skip issues whose `updatedAt` falls between the two timestamps. Subsequent cycles with a persisted cursor do not have this problem.
- **Recommendation:** When cursor was null at cycle start, persist the `since` value used for polling (even on total drain failure), e.g. `setCursor(db, repo, cursor)` in an additional branch, or document that operators must pass `--since` after a failed first run.
