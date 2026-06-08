# Implementation Review Round 1 — Issue #36

## Verdict
pass_with_findings

## Summary

Implementation matches the spec and plan across all six tasks. The watcher stack (`config/`, `state/`, `watcher/`, `commands/watch.ts`) delivers poll → enqueue → drain → cursor advance with SQLite persistence, CLI surface (`watch run` / `watch once`), and injectable deps for testing. All 280 unit tests pass (`npm test`).

**Acceptance criteria:** All five issue criteria are satisfied — configurable polling interval, engine tick drain, restart-resilient cursor with idempotent queue, config/CLI overrides, and rate-limit backoff on 403/429.

**Plan tasks:** Config loader, SQLite bootstrap (WAL + migration 001), watcher store with stale-processing recovery, poll module reusing `GhRunner`, runner orchestration with cursor edge-case branches, and CLI wiring in `cli.ts` with `engines.node >=22.4` are all present and align with the plan.

**Edge-case review:**

| Area | Status |
|---|---|
| Cursor logic (first-run `now()`, `--since` override, duplicate enqueue, all-drain-fail on first run) | Implemented in `runner.ts` with `hadNullCursor` branch |
| Rate limits | `poll.ts` detection + `runWatchLoop` exponential backoff (60s → 15m cap) |
| `ISSUEFLOW_ENGINE` gate | `watch run` gated (exit 3); `watch once` ungated per plan trade-off |
| Stale `processing` recovery | `recoverStaleProcessing` at cycle start (5 min threshold) |
| Poll error handling | Surfaces `pollError`, skips drain, no cursor advance; exit 1 on `once`, stderr on `run` |

No blocking defects. Four minor findings below — graceful-shutdown timing and test coverage gaps.

## Findings

### 1. [minor] `runWatchLoop` omits abort check after normal-interval and poll-error sleeps

**File:** `src/watcher/runner.ts` (lines 117–134)

The rate-limited path checks `signal.aborted` after backoff sleep, but the poll-error and normal-interval paths sleep without checking the abort signal afterward. SIGINT/SIGTERM during a 60s (or longer) wait will not exit until sleep completes, delaying graceful shutdown beyond "finish current cycle."

**Impact:** Operational annoyance, not data loss — the in-flight cycle still completes.

**Suggested fix:** Mirror the rate-limit branch: check `deps.signal?.aborted` after every `sleep()` call.

---

### 2. [minor] No runner unit test for `no-state` refusal → `markDone`

**File:** `src/watcher/runner.ts` (lines 71–75); spec Engine Integration §4–5

The spec requires marking queue rows `done` when the engine refuses with `no-state` to avoid infinite retry. The code implements this (`tickResult.refused.code !== 'no-state'`), but `watcher-runner.test.ts` has no case asserting a refused `no-state` tick results in `done` (not `failed`) and cursor advance.

**Impact:** Regression risk on a spec-critical path; behavior is only indirectly covered by engine tests.

---

### 3. [minor] No unit test for exponential backoff in `runWatchLoop`

**File:** `src/watcher/runner.ts` (lines 123–129)

Rate-limit detection is tested at the poll layer and cycle-skip is tested in `runWatchCycle`, but `runWatchLoop` backoff progression (60s → 120s → … → 15m cap) is untested. A mocked `sleep` asserting backoff durations would lock in spec behavior.

**Impact:** Backoff regression would go unnoticed until integration.

---

### 4. [minor] `pollTriagedIssues` does not guard `JSON.parse` on malformed `gh` stdout

**File:** `src/watcher/poll.ts` (line 69)

On exit code 0 with non-JSON stdout, `JSON.parse` throws and propagates as an unhandled rejection from the watch cycle rather than a structured `pollError`. Unlikely in normal `gh` usage but possible on partial output or CLI bugs.

**Impact:** Crash instead of logged poll error and exit 1; inconsistent with non-zero exit handling.

**Suggested fix:** Wrap parse in try/catch and return `{ issues: [], rateLimited: false, error: message }`.

---

## Spec Coverage Matrix

| Requirement | Implementation | Tests |
|---|---|---|
| Poll interval configurable (default 60s) | `config/types.ts`, `watch run --interval` | `config-load.test.ts`, `watch-command.test.ts` |
| `gh issue list --search` transport | `watcher/poll.ts` | `watcher-poll.test.ts` |
| Trigger label filter (search + code) | `buildIssueSearchQuery`, label re-filter | `watcher-poll.test.ts` |
| SQLite cursor + queue | `state/migrations/001-watcher.ts`, `watcher-store.ts` | `state-db.test.ts`, `watcher-store.test.ts` |
| Engine tick drain | `commands/watch.ts` → `createWorkflowEngine().tick()` | `watcher-runner.test.ts` |
| Rate-limit backoff | `poll.ts` + `runner.ts` loop | `watcher-poll.test.ts` (detection only) |
| `watch run` / `watch once` | `commands/watch.ts`, `cli.ts` | `watch-command.test.ts`, `cli.test.ts` |
| WAL mode + shared DB bootstrap | `state/db.ts` | `state-db.test.ts` |
| `ISSUEFLOW_ENGINE` gate on `run` only | `commands/watch.ts:144` | `watch-command.test.ts` |
| Stale processing recovery | `recoverStaleProcessing` at cycle start | `watcher-store.test.ts` |
| Pagination warning at 100 results | `poll.ts` `onWarn` | `watcher-poll.test.ts` |
| Exit code 1 on failed / poll error (`once`) | `applyCycleExitCode` | `watch-command.test.ts` |
| SIGINT graceful shutdown (finish cycle) | `AbortController` + signal check post-cycle | `watcher-runner.test.ts` |
| Node >=22.4 engines | `package.json` | — |

## Verification

```
npm test — 39 files, 280 tests, all PASS
```
