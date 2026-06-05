# Plan Review — Issue #28, Round 2

## Status: pass_with_findings

## Summary

All thirteen Round 1 findings are addressed in the updated plan: SQL migrations copy to `dist/`, post-build smoke test, fatal upsert contract with ordering assertions, `--json` and exit-code `2` coverage for drift, `loadDriftCandidates` orchestration, round-trip restart test, fuller TDD snippets for Tasks 3–5, native-dependency note, complete `WorktreesCommandDeps`, file-structure fixes, honest self-review wording for concurrency, and per-task commits. The plan remains aligned with the spec's architecture, schema, and acceptance criteria. Two minor new inconsistencies remain in Task 8 integration-test examples and Task 7 drift orchestration (async vs sync `pathExists`); neither is an architecture disagreement, but both should be corrected before an agent copy-pastes the snippets verbatim.

## Findings

1. **minor — Task 8 integration test skeleton does not match the codebase API (plan: Task 8 Step 3).** Examples call `startAction(input, deps)`, `buildStartDeps`, and `launchHost`, but `startAction(options: StartOptions)` accepts only CLI options (no deps injection), host launch happens via `execa` inside `startAction` after `createStartPlan` returns, and existing tests use `createStartPlan(input, createDeps(…))`. Upsert placement line anchors (~331, ~350) live inside `createStartPlan`, not `startAction`; prose still says "In `startAction`", which could mislead an implementer who skips line numbers. Fix: rename placement target to `createStartPlan`, rewrite tests to use `createStartPlan` + `createDeps`, assert `writeSessionState` / `writeIssuePacket` ordering and non-invocation on failure (host launch is outside `createStartPlan` and need not be mocked).

2. **minor — `driftAction` passes async `deps.pathExists` into sync `loadDriftCandidates` (plan: Task 5 Step 3, Task 7 Step 3 line 726).** `loadDriftCandidates` and `detectWorktreeDrift` take synchronous `pathExists: (p) => boolean`, while `WorktreesCommandDeps.pathExists` returns `Promise<boolean>`. The plan line `loadDriftCandidates(allRows, gitPaths, p => deps.pathExists(p))` would pass a Promise to a boolean filter (`!pathExists(row.path)` is always false). Fix: add an orchestration step—e.g. `await Promise.all` over unique paths into a `Map<string, boolean>` or `Set<string>`, then call `loadDriftCandidates` / `detectWorktreeDrift` with a sync lookup—or make `loadDriftCandidates` async. Document the chosen pattern in Task 7 Step 3.

## What looks good

- **Round 1 major fixes verified:** `scripts/copy-state-migrations.mjs` + extended build script + `tests/unit/state-build.test.ts` close the dist/runtime migration gap; Task 8 specifies fatal upsert with stderr, `process.exitCode = 1`, early return, and call-order test; precise upsert placement before `writeSessionState` / `writeIssuePacket` with `--print-only` skip.
- **Round 1 minor fixes verified:** Drift exit `2` test, `--json` on both subcommands, `loadDriftCandidates` with command-level row-selection test, round-trip restart test (Task 4 Step 5 + Task 6), full test blocks for Tasks 3–5, native-dep note and `npm ci` gate, complete `WorktreesCommandDeps` harness mirroring `state.ts`, `state-db.test.ts` in file structure, self-review reworded to "implemented, not multi-process tested", sequential upsert idempotency test, per-task commits throughout.
- File layout, schema, upsert SQL, WAL/busy_timeout, error types, and self-review checklist still match the spec and ADR-0001.
- Tasks 1–2 remain exemplary copy-runnable TDD; injected `Database` on `WorktreeStore` and `getWorktreeStore()` factory match spec DI.
- Test layout follows flat `tests/unit/<name>.test.ts` convention; `tests/integration/start-command.test.ts` remains the correct integration touchpoint once test symbols are corrected.

STATUS=pass_with_findings
