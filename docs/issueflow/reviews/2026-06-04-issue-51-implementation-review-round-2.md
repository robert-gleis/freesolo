# Implementation Review Round 2 — Issue #51

## Verdict
pass

## Round-1 Findings Re-Check

1. **Finding 1 (DB leak on pragma failure)** — addressed. `src/state-store/connection.ts:11-20` now opens the `Database` first, then runs the four pragmas inside a nested try whose catch calls `db.close()` before re-throwing into the outer wrapper. Matches the suggested fix verbatim.
2. **Finding 2 (weak rollback assertion)** — addressed. `tests/unit/state-store-migrations.test.ts:103-111` switches to the try/catch shape used by the sibling tests, pins `code === 'migration-failed'`, and asserts the message contains both `'2'` and `'will-fail'`. Sibling code-pinning style preserved.
3. **Finding 3 (no positive-path coverage for transaction)** — addressed. New test at `tests/unit/state-store-api.test.ts:65-81` calls `store.transaction(() => { … return 42; })`, asserts the return is `42`, and confirms the inserted row is visible after commit by querying `notes` outside the transaction.
4. **Finding 4 (no coverage for store.pragma)** — addressed. New test at `tests/unit/state-store-api.test.ts:83-90` invokes `store.pragma('journal_mode', { simple: true })` (expect `'wal'`) and `store.pragma('busy_timeout', { simple: true })` (expect `5000`). Both the `source` and `options` arguments of the wrapper are exercised, which is exactly the regression Finding 4 was guarding against.
5. **Nit 8 (unclosed DB handles in migrations fixture)** — addressed. `tests/unit/state-store-migrations.test.ts:12-29` tracks every opened handle in `openDbs[]`, and the `afterEach` drains the array and closes each `db` (gated by `db.open` so an already-closed handle is a no-op). Order is correct: close handles first, then `fs.rm` the temp dirs.

## New Findings

None. The fixes are tight and don't introduce new resource-management or correctness issues.

Notes from the independent re-scan (all clear, recorded for the record, not findings):
- **Double-close paths in connection.ts**: the new inner `db.close()` only fires on pragma failure, after which the outer catch rewraps and re-throws. No caller in `store.ts` or elsewhere holds a reference to the partially-opened db on that path, so no double-close. The success path returns `db` without entering the inner catch.
- **afterEach in migrations test**: the `if (db.open)` guard is the right shape — none of the current tests close their own handle, but the guard future-proofs against a test that explicitly calls `db.close()` mid-body. Splice-on-iteration (`openDbs.splice(0)`) prevents cross-test leakage if a single test ever opens multiple DBs.
- **transaction return-value test**: genuinely tests both the return value (catches a regression that dropped to `db.transaction(fn)` without invoking) and the commit (catches a regression that wrapped but never invoked the transaction). Independent post-transaction query, not relying on side-effects observed inside the closure.
- **pragma test**: uses `{ simple: true }` to force scalar return, which is the only way to write a deterministic `.toBe(...)` assertion against pragma output. Correctly exercises the second `options` arg of the wrapper.

Deferred items from round 1 (cross-mount EXDEV in `safeDelete`, nested `StateStoreError` rewrap in migrations, errno passthrough in `fileExists`) remain unchanged and out of scope per the reviewer brief.

## Verification

- `npm test`: PASS — 289 tests across 42 files, 2.16s (was 287; +2 for the new transaction return-value and pragma passthrough tests).
- `npm run build`: PASS — `tsc -p tsconfig.json` clean, `ensure-bin-executable` ran.
- Independent scan of `src/state-store/connection.ts`, `src/state-store/store.ts`, and both updated test files: no new resource-leak, double-close, or assertion-strength regressions detected.

STATUS: pass
