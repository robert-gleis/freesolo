# Plan Review Round 1 — Issue #36

## Verdict
pass_with_findings

## Summary
The plan covers the right module boundaries, schema, and TDD task breakdown and aligns with existing CLI/DI patterns in `engine.ts` and injectable `GhRunner` usage in `state-store.test.ts`, but Task 5’s runner poll interface cannot pass the computed cursor to `pollTriagedIssues`, Task 6 is too thin for the watch command surface (flags, env gate tests, signal handling), and several spec-mandated behaviours (CLI overrides, pagination warning, WAL test, graceful shutdown) are missing or under-specified.

## Findings

### [major] Runner poll callback does not receive the computed `since` cursor
- **Location:** Task 5 — `WatchCycleDeps.poll` and `runWatchCycle` (plan lines 817–842, 858)
- **Issue:** `runWatchCycle` resolves `cursor` from `sinceOverride ?? getCursor() ?? now()` but invokes `deps.poll()` with no arguments. The watch command must wire `pollTriagedIssues({ since, ... })`, yet `since` is only known inside `runWatchCycle`. An implementer would either duplicate cursor logic in the CLI (risking drift with `sinceOverride`) or poll with a stale/wrong timestamp on every cycle.
- **Recommendation:** Change the deps contract to `poll: (since: string) => Promise<PollResult>` and call `await deps.poll(cursor)`. Update the runner test to assert the poll stub receives the expected `since` (including `sinceOverride` and first-run `now()` default).

### [major] Task 6 omits spec-mandated `watch run` CLI flags
- **Location:** Task 6 — `src/commands/watch.ts` (plan lines 947–951); spec CLI Surface (spec lines 171–172)
- **Issue:** The spec requires `freesolo watch run [--interval <seconds>] [--trigger-label <label>]`. Task 6 only mentions config loading and `--since` for `once`. Without explicit flag wiring, CLI overrides for interval and trigger label will not ship.
- **Recommendation:** Add Commander options on `watch run`, merge CLI values over config (flags win when present), validate `interval` against `MIN_INTERVAL_SECONDS`, and add tests in `watch-command.test.ts` for override precedence.

### [major] Task 6 watch command body is underspecified vs existing command patterns
- **Location:** Task 6 — Step 3 (plan lines 945–953); compare `src/commands/engine.ts`, `src/commands/state.ts`
- **Issue:** Task 6 lists bullet goals but no concrete structure: no `WatchCommandDeps` injectable harness (needed for env-gate and exit-code tests), no `withCommanderErrorHandling`-style error wrapping, no reuse of `defaultResolveRepoRef` / `defaultRunner` from existing modules, and no sketch of how `runWatchLoop` receives a poll closure wired with repo, trigger label, and gh runner. This is the highest-risk task and the plan leaves too much to improvisation.
- **Recommendation:** Mirror `EngineCommandDeps`: `resolveRepoRef`, `loadConfig`, `openStateDb`, `runWatchCycle`/`runWatchLoop`, `env`, `write`, `setExitCode`. Wire `poll: (since) => pollTriagedIssues({ repo, since, triggerLabel, gh: defaultRunner })` and `tick` via `createWorkflowEngine(defaultEngineDeps).tick`. Include a minimal code skeleton in the plan.

### [major] `watch-command.test.ts` plan does not cover env gate or exit codes
- **Location:** Task 6 — Step 1 (plan lines 922–937); spec Testing (spec line 228)
- **Issue:** The spec calls for tests covering “CLI registration, env gate, exit codes.” The plan only asserts subcommand names exist. `engine-command.test.ts` already shows the harness pattern for `FREESOLO_ENGINE` gating (exit 3); nothing equivalent is planned for `watch run`, nor is exit code 1 on drain failures exercised.
- **Recommendation:** Add tests: (1) `watch run` refuses without `FREESOLO_ENGINE=1` and exits 3 without calling the runner; (2) `watch once` succeeds without the gate (per spec line 179 — only `run` is gated); (3) cycle with `failed > 0` sets exit code 1.

### [major] No graceful SIGINT/SIGTERM shutdown for `watch run`
- **Location:** Task 5 `runWatchLoop`; Task 6 `watch run` action; spec CLI Surface (spec line 175)
- **Issue:** The spec requires `watch run` to poll until SIGINT/SIGTERM with graceful shutdown that finishes the current drain. `runWatchLoop` is an infinite `for (;;)` with no abort signal, and Task 6 does not mention signal handlers. Compare `src/commands/verify.ts`, which registers `process.once('SIGINT', ...)`.
- **Recommendation:** Add an `AbortSignal` (or `shouldContinue` predicate) to `runWatchLoop`; register SIGINT/SIGTERM in `watch run` to stop after the in-flight `runWatchCycle` completes. Document the behaviour and add a unit test with a mocked sleep/loop that exits after one cycle when aborted.

### [major] Queue rows can remain stuck in `processing` after a crash
- **Location:** Task 3 `listPending` / `markProcessing`; Task 5 drain loop (plan lines 858–875)
- **Issue:** `listPending` selects only `status = 'pending'`. If the process dies after `markProcessing` and before `markDone`/`markFailed`, the row is never drained again. Restarts skip it permanently while the cursor may still advance for other items, leaving issues undetected until manual DB repair.
- **Recommendation:** At cycle start, reset stale `processing` rows older than a threshold back to `pending`, or include `processing` in the drain query with an idempotent tick. At minimum, document the limitation and add a test for the chosen recovery path.

### [major] Non-rate-limit `gh` failures are silently treated as an empty poll
- **Location:** Task 4 `pollTriagedIssues` (plan lines 681–684); Task 5 cursor-advance branch (plan lines 877–878)
- **Issue:** Any non-zero `gh` exit that is not classified as rate-limited returns `{ issues: [], rateLimited: false }` with no error surfaced. Auth failures, network errors, and malformed responses disappear as “no new issues.” The runner’s `pollResult.issues.length === 0` branch still runs cursor logic (no-op when unchanged, but the operator gets no failure signal).
- **Recommendation:** Distinguish rate-limit from other failures: return `{ issues: [], rateLimited: false, error: string }` or throw. Propagate to CLI stderr and set a non-zero exit code for `once`; for `run`, log and continue (or short-circuit the cycle without advancing cursor).

### [minor] Spec internal contradiction on `FREESOLO_ENGINE` gate not flagged
- **Location:** Spec Engine Integration (spec lines 160–161) vs CLI Surface (spec line 179); Task 6 (plan line 949)
- **Issue:** The spec says the watch command itself does not require the env var (line 160) but also that `run` requires `FREESOLO_ENGINE=1` (line 179). The plan follows line 179 for `run` only but does not note the contradiction or clarify whether `once` (which also drains) should be gated. In-process `createWorkflowEngine().tick()` bypasses the CLI gate anyway — the gate is operational, not enforced inside the engine.
- **Recommendation:** Add a one-line plan note resolving the contradiction (gate `run` only, per CLI section) and ensure tests lock that contract.

### [minor] Missing WAL mode test promised by spec
- **Location:** Task 2 — `tests/unit/state-db.test.ts` (plan lines 255–277); spec Testing (spec line 224)
- **Issue:** The spec lists “migrations apply once, WAL mode, temp db path” for `state-db.test.ts`. The plan tests table creation and migration idempotency but never asserts `PRAGMA journal_mode` returns `wal`.
- **Recommendation:** Add `it('enables WAL journal mode', ...)` querying `PRAGMA journal_mode` after `openStateDb`.

### [minor] Missing pagination warning when `--limit 100` is saturated
- **Location:** Task 4 `pollTriagedIssues`; spec Polling (spec line 152)
- **Issue:** When GitHub returns 100 issues, the spec requires logging a warning. The poll module and runner have no `onWarn`/`write` hook for this case.
- **Recommendation:** If `raw.length === 100`, emit a stderr warning via an injected logger in deps. Add a poll unit test.

### [minor] Duplicate `GhRunner` type instead of reusing `state-store` exports
- **Location:** Task 4 `src/watcher/poll.ts` (plan lines 624–630); `src/workflow/state-store.ts`
- **Issue:** The plan defines a new `GhRunner`/`GhResult` pair in `poll.ts`. The codebase already exports identical types and `defaultRunner` (with execa spawn-failure handling) from `state-store.ts`. Duplication invites drift and skips the friendly “GitHub CLI” error path tested in `state-store.test.ts`.
- **Recommendation:** Import `GhRunner`, `GhResult`, and `defaultRunner` from `../workflow/state-store.js`.

### [minor] Config validation errors omit the config path required by spec
- **Location:** Task 1 `loadConfig` / `validateWatcher` (plan lines 182–208); spec `load.ts` (spec line 185)
- **Issue:** The spec says parsing/validation failures should throw with the path in the message. `validateWatcher` throws generic messages without `configPath`.
- **Recommendation:** Pass `configPath` into validation and include it in error strings, e.g. `` `${configPath}: watcher.interval_seconds must be >= 5` ``.

### [minor] `engines.node` version mismatch with spec final decision
- **Location:** Task 6 / `package.json` (plan line 955); spec `db.ts` (spec line 190)
- **Issue:** The spec’s final decision documents Node `>=22.4` (when `node:sqlite` stabilized). The plan bumps to `>=22` only.
- **Recommendation:** Align to `>=22.4` in `package.json` or note why `>=22` is sufficient for the `DatabaseSync` API in use.

### [minor] Self-review “No gaps found” is inaccurate
- **Location:** Plan Spec Coverage Self-Review (plan lines 968–981)
- **Issue:** The self-review table omits CLI flag overrides, signal handling, env-gate/exit-code tests, pagination warning, WAL test, and poll `since` wiring — all spec-backed items.
- **Recommendation:** Update the self-review after addressing findings so implementers do not treat the table as exhaustive sign-off.
