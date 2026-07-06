# Plan Review — Issue #23, Round 2

## Status
pass

## Summary
The revised plan resolves both round 1 major findings. Migration registration is now single-path (append to `BASE_MIGRATIONS` only; `openEventLog` calls `openStateStore({ path })` with no duplicate spread). Task 2's migration test is copy-runnable: async `tempDb()`, schema introspection via `openStateStore` + `store.unsafe`, and an explicit idempotent re-open case. Task ordering now preserves TDD red/green for append (Task 3) and query (Task 4), with a throwing skeleton landing in Task 2. Remaining gaps are minor polish — partial idempotent coverage, stale trade-off prose, and bullet-only test plans for query/concurrency — none block implementation.

## Round 1 Resolution

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | major | Duplicate migration registration (BASE_MIGRATIONS + ALL_MIGRATIONS spread) | **Fixed** — Accepted Design Trade-offs and Task 2 skeleton use `openStateStore({ path })` only; migration registered once in `BASE_MIGRATIONS`. |
| 2 | major | Task 2 migration test copy-paste unsafe (`log['store'].unsafe`, broken async) | **Fixed** — Step 1 snippet uses `await tempDb()`, `openStateStore({ path })`, and `store.unsafe` for introspection. |
| 3 | minor | Missing idempotent re-open test | **Partially fixed** — `it('is idempotent on second open', …)` added, but does not append on second open (see finding 1 below). |
| 4 | minor | TDD red/green inverts for append/query | **Fixed** — Task 2 ships skeleton; Task 3 append TDD; Task 4 query TDD. |
| 5 | minor | Query test omits `workflowId` filter | **Fixed** — Task 4 includes concrete `workflowId` filter test block. |
| 6 | minor | Tasks 4–6 lack concrete test/fixture code | **Partially fixed** — concurrency fixture is complete; append/migration tests are full snippets; query and concurrency *test files* remain bullet-only. |
| 7 | minor | `list()` after `close()` not covered | **Fixed** — Task 3 includes `throws closed after close for append and list`. |
| 8 | minor | Concurrency test thinner than #51 | **Mostly fixed** — asserts total count, per-worker `written`, unique ids, per-PID counts; missing monotonic id ordering (see finding 2). |
| 9 | nit | `createWorkflowEngineSink` invented symbol | **Fixed** — removed; trade-off now references deferred wiring generically. |
| 10 | nit | No per-task commit steps | **Fixed** — each task ends with explicit `git commit`. |
| 11 | nit | `OpenEventLogOptions.now` undocumented | **Fixed** — documented in Accepted Design Trade-offs as test-only injection. |

## Findings

1. **minor — Idempotent re-open test does not exercise append (Task 2 Step 1, `tests/unit/event-log-migration.test.ts`).** Round 1 asked for a second open that also appends without error. The revised test only asserts `second.path === dbPath` and closes — it confirms migration runner idempotency but not that the `events` table remains writable after re-open. Consider adding `second.append({ eventType: 'agent.created' })` (or a smoke `list()`) before close; alternatively accept current coverage since Task 3 append tests will catch table usability regressions.

2. **minor — Concurrency assertions omit monotonic id ordering (Task 5 Step 2).** `#51`'s `state-store-concurrency.test.ts` asserts both globally unique ids *and* strictly increasing order (`ids[i] > ids[i-1]`). The plan lists unique ids and per-PID counts but not ordering. Under concurrent AUTOINCREMENT this is a cheap corruption signal; one line mirroring #51 would close the gap.

3. **minor — Task 4 and Task 5 concurrency test files remain bullet-only (Tasks 4 Step 1, 5 Step 2).** The fixture (`event-log-concurrent-writer.mjs`) is now a complete, copy-runnable snippet with IPC callback — matching #51's hardened pattern. The query and concurrency *vitest* files are still described as bullets ("Seed rows…", "mirror state-store-concurrency.test.ts"). Executor variance risk is reduced versus round 1 but not eliminated. Optional improvement: embed a minimal runnable test skeleton for Task 4 filters/limit-clamp.

4. **nit — Stale task numbering in Accepted Design Trade-offs (line 39).** Prose reads "Tasks 4–5 are strict TDD. Task 3 ships only open/close wiring" — but Task 2 ships the open/close skeleton and Task 3 is append TDD. Update to "Tasks 3–4 are strict TDD; Task 2 ships open/close skeleton with throwing append/list stubs."

## What looks good

- **Both round 1 majors fully resolved.** No runtime `duplicate migration version 2` path remains; migration test compiles and runs as written.
- **TDD sequencing is now coherent.** Skeleton → append red/green → query red/green → concurrency characterization matches the spec and #51 plan style.
- **Round 1 nit fixes landed cleanly.** Per-task commits, `now` injection documented, invented helper name removed.
- **Concurrency fixture matches #51 precedent.** Raw `better-sqlite3` INSERTs, WAL/busy_timeout pragmas, IPC callback form of `process.send`, env-var configuration — all present in Task 5 Step 1.
- **Spec alignment unchanged and strong.** Eight event types, migration v2 DDL, append/list API, error codes, limit clamp, engine isolation, and self-review checklist all track the design doc.
- **Closed-state coverage is complete.** Both `append` and `list` after `close()` are in Task 3 tests, matching spec error handling.

STATUS=pass
