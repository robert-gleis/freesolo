# Implementation Review Round 1 — Issue #51

## Verdict
pass_with_findings

## Summary
The implementation is a faithful execution of the approved plan. Public surface, file layout, pragma ordering, migration runner semantics, backup, safe-delete and the cross-process concurrency test all match the spec. The full vitest suite (287 tests) and `tsc -p tsconfig.json` build are both clean. Findings below are minor: a small resource-leak window in `openConnection`, a couple of tests that assert weaker invariants than the spec promises, and two genuinely-uncovered behaviours (`transaction` return value, `safeDelete` cross-mount). Nothing blocks the consumer tickets (#23, #28, #36).

## Findings

1. **(should-fix)** `src/state-store/connection.ts:9-16` — DB handle leak on pragma failure. The single `try` block opens `new Database(dbPath)` and then applies four pragmas inside the same `try`. If any pragma throws (e.g. a future `synchronous=...` value rejected by a newer SQLite), the `Database` handle is created but never closed before the catch wraps and re-throws. better-sqlite3 holds an open file descriptor and a libsqlite3 handle on that DB; relying on GC to release them is sloppy and historically has caused intermittent `EBUSY`/`SQLITE_BUSY` test flakes on Windows when the parent directory is then `rm -rf`-ed.
   *Suggested fix:* split the pragma application into a nested try/catch that calls `db.close()` before re-throwing, e.g.
   ```ts
   const db = new Database(dbPath);
   try {
     db.pragma('journal_mode = WAL');
     db.pragma('synchronous = NORMAL');
     db.pragma('foreign_keys = ON');
     db.pragma('busy_timeout = 5000');
   } catch (error) {
     db.close();
     throw error;
   }
   return db;
   ```
   Same pattern is already used correctly in `store.ts` (close on `runMigrations` failure).

2. **(should-fix)** `tests/unit/state-store-migrations.test.ts:96` — the "rolls back a failing migration" test asserts only `toThrowError(StateStoreError)` without pinning `error.code === 'migration-failed'`. The implementation does set the code correctly, but any future regression that surfaces the *raw* `Error('boom')` through (or that mislabels it as e.g. `migration-version-conflict`) would still pass this test because both are `StateStoreError`. The spec explicitly distinguishes `migration-failed` from `migration-version-conflict`, so the test should pin both codes separately. The duplicate-version and applied-but-missing tests *do* pin their codes — only this one is weaker.
   *Suggested fix:* refactor the rollback test to the same `try { … } catch { expect(code).toBe('migration-failed'); … }` shape used by the sibling tests, and also assert the message contains the offending version and name as the spec promises ("the error message includes the offending version and name").

3. **(should-fix)** `tests/unit/state-store-api.test.ts` — `store.transaction(fn)` has no positive-path coverage. Only the throw/rollback case is tested. If the implementation accidentally regressed to `db.transaction(fn)` (returning the transaction *function* rather than calling it) or returned `undefined`, the rollback test would still pass. Add one spec that asserts the return value of a successful `store.transaction(() => 42)` is `42`, and that side-effects committed inside the transaction are visible afterwards.

4. **(should-fix)** Missing direct coverage for `store.pragma()` passthrough. `pragma` is part of the documented public surface (`StateStore.pragma`) but `state-store-api.test.ts` never invokes it. The pragmas are exercised through `openConnection` directly, not via the `StateStore` handle, so a regression that broke the wrapper (e.g. dropping the second `options` argument) would not be caught. One assertion like `expect(store.pragma('journal_mode', { simple: true })).toBe('wal')` closes the gap.

5. **(nit)** `src/state-store/backup.ts:57-78` (`safeDelete`) — uses `fs.renameSync`, which fails with `EXDEV` if `trashRoot` and `sourcePath` are on different filesystems. With the default `resolveTrashDir()` this never happens (both under `ISSUEFLOW_HOME`), but a consumer passing a custom `trashRoot` on a different mount would hit it. The error would surface correctly as `safe-delete-failed`, so it's not a bug — just a sharp edge worth documenting in `safeDelete`'s JSDoc, or, if appetite exists, falling back to `copyFileSync` + `unlinkSync` on `EXDEV`. Acceptable to defer; flagged so a future CLI ticket doesn't get surprised.

6. **(nit)** `src/state-store/migrations.ts:58-72` — when `migration.up(db)` itself throws a `StateStoreError`, it gets *re-wrapped* into another `StateStoreError('migration-failed', …)`, losing the original code. In practice migrations are written by consumers and use raw `Error`/`db.exec` failures, so this is theoretical. If desired, skip the wrap when `error instanceof StateStoreError`.

7. **(nit)** `src/state-store/backup.ts:43-55` (`fileExists`) — re-throws non-ENOENT errors out of `safeDelete`'s `try`, which then catches and re-wraps as `safe-delete-failed`. Net behaviour is correct (any unexpected stat error becomes a typed error), but the catch swallows the underlying `errno`. The spec's failure-mode commentary says messages should include the underlying cause; the current message includes `error.message` which is usually enough, so this is a stylistic observation rather than a real gap.

8. **(nit)** `tests/unit/state-store-migrations.test.ts:13-18` — `makeDb()` opens a `better-sqlite3` connection per test but never `db.close()`s it. The `afterEach` `fs.rm` removes the directory, but the DB handle stays alive until GC. On POSIX this is harmless; if these tests ever run on Windows in CI, the `rm` will EPERM-fail because the file is still open. Closing the handle in `afterEach` would future-proof it.

## Strengths

- Clean separation between modules: `connection.ts`, `migrations.ts`, `backup.ts`, `paths.ts`, and `store.ts` each own a single responsibility; the barrel `index.ts` re-exports only the public surface.
- The `StateStore` interface uses method syntax (not `bind`) for `prepare` and `pragma`, preserving better-sqlite3's overloads. Comments explain why — easy to maintain.
- `openStateStore` correctly closes the DB if `runMigrations` throws (good failure-path hygiene).
- `state-store-engine-isolation.test.ts` regex is carefully crafted to avoid matching the legacy `src/workflow/state-store.ts` (the test even comments the rationale). Independent verification: it correctly distinguishes `./state-store.js` (workflow legacy) from `../state-store/...` (new module).
- The concurrent-writer fixture uses the IPC-flush callback form of `process.send` — a known race that catches less-careful implementations.
- `safeDelete` snapshot-tests with `seedDbLeavingWal()` use `wal_autocheckpoint = 0` to make WAL/SHM presence deterministic, rather than asserting against unspecified SQLite default behaviour.
- Type safety: no `any` casts in production code; the `as Array<…>` casts in tests are localized and unavoidable given better-sqlite3's `unknown` return type.
- Engine isolation regression test pins both the import path *and* `better-sqlite3` directly, so a consumer accidentally pulling SQLite into `src/workflow/` will fail loud.

## Verification

- `npm test`: PASS (287 tests across 42 files, 2.74s)
- `npm run build`: PASS (`tsc -p tsconfig.json` clean, `ensure-bin-executable` ran)
