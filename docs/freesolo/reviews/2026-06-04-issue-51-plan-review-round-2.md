# Plan Review Round 2 — Issue #51

## Verdict
pass

## Round-1 Findings Re-Check

1. **addressed** — `tests/unit/state-store-safe-delete.test.ts` "also moves -wal and -shm when present" (plan lines 1029-1060) now snapshots WAL/SHM presence into `preExisting` *before* calling `safeDelete`, then asserts each pre-existing sibling is gone from the source dir, present under `trashRoot`, and listed in `result.movedFiles`. The previous broken-loop pattern is gone.

2. **addressed** — `state-store-safe-delete.test.ts` seed helper now calls `db.pragma('wal_checkpoint(TRUNCATE)')` immediately before `db.close()` (plan lines 989-994), with a comment explaining why. The strict `expect(result.movedFiles.sort()).toEqual(['state.db'].sort())` assertion is now contractually safe rather than relying on platform-default close-time checkpointing.

3. **addressed** — `tests/fixtures/state-store-concurrent-writer.mjs` (plan lines 1580-1585) uses the callback form `process.send({...}, undefined, undefined, () => process.exit(0))` so the IPC channel is flushed before exit. The race the round-1 review described is closed.

4. **addressed** — `src/state-store/types.ts` (plan lines 249-258) and `src/state-store/store.ts` (plan lines 1365-1380) both use method syntax for `prepare` and `pragma`. The `StateStore.prepare` signature is the generic `<TParams extends unknown[] = unknown[], TResult = unknown>(sql: string): Database.Statement<TParams, TResult>`, and the store implementation forwards via `prepare(sql) { ensureOpen(); return db.prepare(sql); }`. I verified by extracting the exact shape against `@types/better-sqlite3` 7.6.13 with `strict: true`, `module: NodeNext`, `target: ES2022` — it compiles. `ensureOpen()` is now also called from both methods, fixing the bypass identified in Finding 9.

5. **addressed** — `tests/unit/state-store-engine-isolation.test.ts` (plan lines 1485-1491) carries a comment explaining what the regex matches and (deliberately) doesn't match: the existing `src/workflow/state-store.ts` file via `from './state-store.js'` vs. the new `src/state-store/` directory via `from '.../state-store/...'` or `from '.../state-store'`. I sanity-checked the regex against both forms in a quick `node -e` and confirmed the behaviour.

6. **addressed** — Task 2 Step 2 and Step 4 (plan lines 187, 269) now read "PASS (6 specs)" and "FAIL — module … cannot be resolved" respectively, matching the actual 6 `it` blocks in the file.

7. **addressed** — Task 1 Step 3 (plan lines 67-86) uses `SMOKE=$(mktemp -t sqlite-smoke.XXXXXX.mjs)`, echoes the path, and `rm "$SMOKE"`s it after. No hard-coded `/tmp/sqlite-smoke.mjs` remains.

8. **addressed** — Task 12 Step 3 (plan line 1750) now uses `ls -R dist/src/state-store/` and includes a representative directory listing showing both the seven top-level `.js` files and the `migrations/` subdirectory contents.

9. **addressed** — `tests/unit/state-store-api.test.ts` has a new sixth spec "prepare() after close() throws StateStoreError(\"closed\")" (plan lines 1298-1310). Combined with the method-syntax change in Finding 4, `prepare` now consistently fails closed.

10. **addressed** — Plan lines 1779-1782 carry an explicit callout: "Extra invariant (not in the GitHub issue's acceptance list): Task 10 / `state-store-engine-isolation.test.ts` pins that `src/workflow/` does not import from `src/state-store/` or `better-sqlite3`. This is a regression guard we choose to lock in addition to the acceptance criteria above." Reviewers skimming the table will no longer try to find this criterion upstream.

## New Findings

(None blocking.)

1. **nit — `tests/unit/state-store-safe-delete.test.ts` first spec carries a minor residual flake risk despite the TRUNCATE checkpoint (plan lines 1017-1027).** SQLite's clean-up of `state.db-wal` / `state.db-shm` at last-connection close is best-effort: it relies on the file deletion succeeding, which can fail on Windows when a handle is held open by another process (virus scanner, indexer). The round-1 reviewer flagged this option explicitly and the fixer chose strict-equality with TRUNCATE; this is a fine call on macOS/Linux CI but if the project later runs Windows CI, the first spec is the most likely flake. Either pin CI to non-Windows for this test or relax the strict-equality to `expect(result.movedFiles).toContain('state.db')` and let the second spec own the WAL/SHM cases. Not blocking — the second spec independently verifies WAL/SHM moves, so the safety net exists.

2. **nit — commit-message convention diverges from the repo's prevailing style.** Recent commits (`5f8626b`, `f26ff28`, `48b341f`, `4cf4804`, `c3bc5aa`, …) use sentence-case prose without Conventional Commits prefixes ("Add regression test guarding workflow engine isolation from runners", "Implement ScriptedRunner.stop including no-op and error-to-stopped paths"). The plan's commits use `feat(state-store): …`, `test(state-store): …`, `deps: …`. The plan's messages are internally consistent and informative, but they break the repo's pattern. If the project has not adopted Conventional Commits intentionally, consider rewriting to match the existing style. Not blocking — this is a project-convention call.

## Summary

Every round-1 finding is correctly addressed, and the fixes do not introduce new compilation, ordering, or coverage problems. The method-syntax `prepare`/`pragma` declarations compile cleanly against `@types/better-sqlite3` 7.6.13 under strict NodeNext/ES2022 (I extracted the actual library types and ran a minimal repro). The two new findings are stylistic / platform-CI nits that don't affect correctness on darwin/linux. The plan is ready to implement.

STATUS: pass
