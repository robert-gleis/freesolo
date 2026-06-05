# Plan Review — Issue #28, Round 3

## Status: pass

## Summary

Both Round 2 findings are resolved in the updated plan. Task 8 now targets `createStartPlan` (not `startAction`) for upsert placement, integration tests use `createStartPlan` + `createDeps` with call-order and failure-path assertions against `writeSessionState` / `writeIssuePacket`, and Task 7 documents a preflight `Promise.all` over `deps.pathExists` into a sync `Map<string, boolean>` before calling `loadDriftCandidates` and `detectWorktreeDrift`. The plan remains aligned with the spec's architecture, schema, CLI surface, fatal upsert contract, dist migration pipeline, and acceptance criteria. No new blockers or copy-paste hazards were found.

## Findings

None.

## Round 2 verification

| Round 2 finding | Resolution |
|---|---|
| Task 8 integration test skeleton mismatched codebase API | **Fixed.** Step 2 names `createStartPlan` with line anchors (~331, ~350); Step 3 tests call `createStartPlan(…, createDeps(…))`, assert upsert-before-session ordering, and assert `writeSessionState` / `writeIssuePacket` are not invoked on upsert failure. Matches existing `tests/integration/start-command.test.ts` harness (`issue()` defaults to number 12). |
| Async `deps.pathExists` passed into sync drift helpers | **Fixed.** Task 7 Step 3 adds preflight path-existence batching via `await Promise.all` into `pathExistsSync`, then passes sync lookups `(p) => pathExistsSync.get(p) ?? false` to both `loadDriftCandidates` and `detectWorktreeDrift`. Task 5 Step 3 documents synchronous `pathExists` injection on the pure functions. |

## What looks good

- Round 1 and Round 2 fixes remain intact: SQL copy to `dist/`, post-build smoke test, fatal upsert contract, `--json` and exit-code `2` coverage, `loadDriftCandidates` orchestration, round-trip restart test, full TDD snippets, native-dependency note, complete `WorktreesCommandDeps`, file-structure completeness, honest self-review concurrency wording, and per-task commits.
- File layout, schema, upsert SQL, WAL/busy_timeout, error types, and self-review checklist match the spec and ADR-0001.
- Tasks 1–2 remain exemplary copy-runnable TDD; injected `Database` on `WorktreeStore` and `getWorktreeStore()` factory match spec DI.
- Test layout follows flat `tests/unit/<name>.test.ts` convention; `tests/integration/start-command.test.ts` is the correct integration touchpoint with corrected symbols.

STATUS=pass
