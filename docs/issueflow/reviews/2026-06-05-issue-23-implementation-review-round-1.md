# Implementation Review Round 1 — Issue #23

## Verdict
pass_with_findings

## Summary
The Agent Event Log implementation matches the approved spec and plan. Module layout (`types.ts`, `migration.ts`, `store.ts`, `index.ts`), migration version 2 DDL, eight canonical event types, append/list semantics, error wrapping, and WAL concurrency coverage are all in place. `src/workflow/` is untouched. Migration registration is single-path via `BASE_MIGRATIONS`; `state-store-api.test.ts` correctly expects versions `[1, 2]`. Full suite (302 tests) and `tsc` build are clean. Findings are test-coverage gaps and minor edge cases — no functional bugs block merge.

## Acceptance criteria check

| Criterion | Status | Evidence |
|---|---|---|
| Append-only, ISO-8601 timestamped | **Met** | No update/delete APIs; `append` sets `created_at` via `now().toISOString()`; append test pins ISO regex and fixed clock |
| Queryable by agent, issue, event type | **Met** | Three indices in migration; `list` filters + query tests for `eventType`, `issueId`, `agentId`, `workflowId` |
| Schema versioned | **Met** | `schema_version` column; `CURRENT_EVENT_SCHEMA_VERSION = 1`; append test asserts default version on returned record |
| Concurrent append safe (WAL) | **Met** | `event-log-concurrency.test.ts`: 4×25 rows, unique monotonic ids, per-PID counts |
| No workflow engine coupling | **Met** | Zero changes under `src/workflow/`; event-log imports only `state-store` |

## Plan task checklist

| Task | Status |
|---|---|
| Task 1 — types + error class | Done; matches plan snippet |
| Task 2 — migration + skeleton store | Done; registered in `BASE_MIGRATIONS` |
| Task 3 — append TDD | Done |
| Task 4 — query TDD | Done |
| Task 5 — concurrency fixture + test | Done; includes monotonic id ordering (#51 parity) |
| Task 6 — full suite + build | Done |

## Findings

1. **(should-fix)** `tests/unit/event-log-query.test.ts:57-58` — limit clamp is not actually exercised. The test seeds 5 rows and calls `list({ limit: 9999 })`, expecting 5 results. `Math.min(9999, 1000)` evaluates to 1000, but with only 5 rows any implementation that ignores the clamp (or uses the raw `9999`) would still pass. The spec promises "values above 1000 are clamped to 1000."
   *Suggested fix:* seed >1000 rows (or mock/count via direct SQL insert), assert `list({ limit: 9999 }).length === 1000`.

2. **(should-fix)** `tests/unit/event-log-query.test.ts` — default limit of 100 is untested. Spec: "Max rows, default 100." No test calls `list()` without `limit` on a dataset larger than 100.
   *Suggested fix:* insert 101 rows (loop or bulk SQL), assert `log.list().length === 100` and that returned ids are the 101 newest ones.

3. **(should-fix)** `tests/unit/event-log-append.test.ts:43-52` — invalid event type rejection does not verify the row was not inserted. The test pins `invalid-event-type` (good) but never asserts `COUNT(*) === 0`. A regression that validates then still inserts would pass.
   *Suggested fix:* after the rejected append, reopen via `openStateStore` or a fresh `openEventLog` and assert zero rows in `events`.

4. **(should-fix)** `tests/unit/event-log-append.test.ts:55-60` — closed-state tests assert `toThrow(EventLogError)` but do not pin `error.code === 'closed'`. Spec distinguishes `'closed'` from `'append-failed'` / `'query-failed'`.
   *Suggested fix:* use the same `try/catch` + `expect(code).toBe('closed')` pattern as the invalid-type test.

5. **(should-fix)** `tests/unit/event-log-append.test.ts:27-40` — append persistence is inferred from the return value only, not from a read-back. Title says "persists" but never queries the DB (via `list()` or raw SQL).
   *Suggested fix:* after append, `expect(log.list()).toEqual([record])` (or match by id) before close.

6. **(nit)** No test covers non-empty `payload` round-trip through append → list. Query tests pass `{ i }` in payload but only assert counts/filters, not deserialized payload equality.
   *Suggested fix:* one assertion that `log.list()[0].payload` deep-equals the appended object.

7. **(nit)** `AppendEventInput.schemaVersion` override is documented for forward-compat tests but never exercised. Low risk since the INSERT binds the value correctly in code.
   *Suggested fix:* append with `schemaVersion: 99`, assert returned record and list row both carry 99.

8. **(nit)** `src/event-log/store.ts:133` — negative `limit` bypasses the 1000 cap. `Math.min(-1, 1000)` is `-1`; SQLite treats `LIMIT -1` as unlimited (verified: returns all rows). Spec only documents default 100 and max 1000; callers passing negative limits get unbounded scans.
   *Suggested fix:* clamp with `Math.max(1, Math.min(query.limit ?? 100, 1000))` or reject non-positive limits. Acceptable to defer if the typed API is internal-only.

9. **(nit)** `src/state-store/migrations/index.ts:4` imports `eventsMigration` from `../../event-log/migration.js`, inverting the usual dependency arrow (state-store layer depends on event-log consumer). Intentional per plan ("consumer owns DAO, registers once in BASE_MIGRATIONS") but worth noting for #28/#36: future migrations should follow the same pattern and avoid pulling event-log internals into unrelated modules.

10. **(nit)** `src/event-log/index.ts:1` exports `OpenEventLogOptions` including the test-only `now` clock injection. Spec public surface is `{ path?: string }` only. Harmless for a library not yet published, but consider exporting `now` only from `store.js` in tests (direct import) if API stability matters before #24 wiring.

11. **(nit)** `src/event-log/store.ts:33-37` — `mapRow` silently coerces invalid `payload_json` to `{}` on parse failure. Spec says payloads are always valid JSON at write time; this defensive path is reasonable for raw-INSERT corruption (concurrency fixture) but untested.
   *Suggested fix (optional): one unit test inserting malformed JSON via `store.unsafe` and asserting empty payload, or document the behaviour in a code comment.

## Strengths

- DDL, index names, and column types match the spec verbatim.
- `append` validates `eventType` before INSERT; SQLite failures wrap as typed `EventLogError` without swallowing `EventLogError` rethrows.
- Row mapping is consistent: snake_case in SQL, camelCase in `EventRecord`; optional dimensions stored as SQL `NULL`.
- `close()` is idempotent and owns the underlying `StateStore` lifecycle.
- Concurrency test mirrors #51's hardened pattern: parent runs migrations first, forked workers use raw `better-sqlite3` INSERTs, IPC callback flush, WAL + busy_timeout, monotonic id ordering assertion.
- Plan trade-offs honoured: no workflow wiring, TDD sequencing, test-only `now` injection, flat test layout under `tests/unit/`.
- Type safety: no `any` in production code; localized casts in tests only.

## Verification

- `npm test`: PASS (302 tests across 47 files, 2.89s)
- `npm run build`: PASS (`tsc -p tsconfig.json` clean, `ensure-bin-executable` ran)

STATUS=pass_with_findings
