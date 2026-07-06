# Implementation Review Round 2 — Issue #23

## Verdict
pass

## Summary
All five Round 1 **should-fix** items are resolved in `store.ts` and the event-log unit tests. Limit clamping now uses `Math.max(1, Math.min(limit ?? 100, 1000))`, query tests seed >1000 rows to exercise default and max limits, append tests verify read-back persistence, zero-row rejection on invalid types, and pinned `'closed'` error codes. Round 1 nits for payload round-trip and `schemaVersion` override are covered by a new append test. Full suite (303 tests) and `tsc` build are clean. No new functional or test-coverage gaps block merge.

## Round-1 Findings Re-Check

1. **Finding 1 (limit clamp not exercised)** — **resolved.** `tests/unit/event-log-query.test.ts:58-63` bulk-inserts 1100 additional rows (1105 total) and asserts `log.list({ limit: 9999 }).length === 1000`. `src/event-log/store.ts:133` clamps with `Math.min(..., 1000)`.
2. **Finding 2 (default limit 100 untested)** — **resolved.** Same test asserts `log.list().length === 100` on a dataset of 1105 rows. Ordering (`id DESC`) is independently verified in the `limit: 2` assertion at lines 53-56.
3. **Finding 3 (invalid type insert not verified)** — **resolved.** `tests/unit/event-log-append.test.ts:57-63` reopens the DB via `openStateStore` and asserts `COUNT(*) === 0`.
4. **Finding 4 (closed code not pinned)** — **resolved.** `tests/unit/event-log-append.test.ts:70-84` uses try/catch and asserts `code === 'closed'` for both `append` and `list`.
5. **Finding 5 (append persistence not read back)** — **resolved.** `tests/unit/event-log-append.test.ts:41` asserts `log.list()` equals the returned record before close.
6. **Nit 6 (payload round-trip)** — **resolved.** New test `round-trips custom payload and schemaVersion` at `tests/unit/event-log-append.test.ts:87-98` deep-equals payload after append → list.
7. **Nit 7 (`schemaVersion` override)** — **resolved.** Same test appends with `schemaVersion: 99` and asserts both returned list row and persistence.
8. **Nit 8 (negative limit bypasses cap)** — **resolved in code.** `src/event-log/store.ts:133` wraps with `Math.max(1, ...)`, so negative limits clamp to 1 instead of SQLite unlimited `-1`. No dedicated test; acceptable for internal typed API.
9. **Nit 9 (state-store imports event-log migration)** — **unchanged, intentional.** Per plan trade-off; consumer owns DAO and registers once in `BASE_MIGRATIONS`.
10. **Nit 10 (`OpenEventLogOptions` exported from barrel)** — **unchanged.** Test-only `now` injection remains exported from `index.ts`; harmless pre-#24 wiring.
11. **Nit 11 (`mapRow` malformed JSON coercion)** — **unchanged.** Defensive `{}` fallback on parse failure remains untested; low risk given append always writes valid JSON.

## Acceptance criteria check

| Criterion | Status | Evidence |
|---|---|---|
| Append-only, ISO-8601 timestamped | **Met** | No update/delete APIs; fixed-clock append test; read-back via `list()` |
| Queryable by agent, issue, event type | **Met** | Migration indices; filter tests including `workflowId`; AND semantics |
| Schema versioned | **Met** | Column + constant; default and override (99) tested |
| Concurrent append safe (WAL) | **Met** | `event-log-concurrency.test.ts` unchanged; 4×25 rows, monotonic ids |
| No workflow engine coupling | **Met** | Zero imports under `src/workflow/`; event-log depends only on `state-store` |

## New Findings

None.

Notes from independent re-scan (recorded for the record, not findings):

- **`mapRow` canonical type guard** (`src/event-log/store.ts:38-40`): `list` now throws `query-failed` if a stored row has a non-canonical `event_type`. Reasonable defense against raw-INSERT corruption; concurrency fixture uses `'agent.created'`. Untested but consistent with append-time validation.
- **Default-limit test strength**: bulk test pins count (100) but not explicit id range for the newest 100 rows. Ordering is already covered by the `limit: 2` case in the same test; no regression risk identified.
- **Migration registration**: `state-store-api.test.ts:116` still expects `schema_migrations` versions `[1, 2]` after default open — correct single-path registration via `BASE_MIGRATIONS`.

## Verification

- `npm test`: PASS — 303 tests across 47 files, 2.92s (was 302; +1 for payload/schemaVersion round-trip test).
- `npm run build`: PASS — `tsc -p tsconfig.json` clean, `ensure-bin-executable` ran.
- Independent scan of `src/event-log/*`, all five `tests/unit/event-log-*.test.ts`, and `src/state-store/migrations/index.ts`: no new correctness, resource-leak, or assertion-strength regressions detected.

STATUS=pass
