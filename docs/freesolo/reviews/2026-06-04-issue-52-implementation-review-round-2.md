# Implementation Review — Issue #52, Round 2

**Status:** pass

**Reviewer summary:** All four round-1 fixes are correctly applied and verified. The full test suite passes cleanly at 337/337 across 41 test files, and the snapshot test confirms the `buildTeamPrompt` output reflects the dynamically-derived host enum.

**Test suite:** 337/337 passed

## Round-1 Fix Verification

| # | Fix | Verified? |
|---|-----|-----------|
| 1 | buildRetryPrompt removed from barrel | ✓ |
| 2 | Host enum derived dynamically | ✓ |
| 3 | Stopped adapter lifecycle test | ✓ |
| 4 | Empty-string extractJson test | ✓ |

### Detail

**Fix 1** — `buildRetryPrompt` is absent from both `src/planner/prompts/index.ts` (which exports only `buildTeamPrompt` and `buildDecompositionPrompt`) and `src/planner/index.ts` (which re-exports those two plus schemas, runtime functions, `extractJson`, and `PlannerError`). The function lives only in `src/planner/prompts/retry.ts` and is consumed internally by `runtime.ts` — the correct placement.

**Fix 2** — `src/planner/prompts/team.ts` line 4 computes `const hostEnum = PLANNER_HOSTS.map(h => '"${h}"').join(' | ')` using the live `PLANNER_HOSTS` constant imported from `schemas/team-definition.ts`. The snapshot at `tests/unit/__snapshots__/planner-prompts.snapshot.test.ts.snap` reflects the current array order (`"pi" | "claude" | "codex" | "cursor"`), and `npx vitest run tests/unit/planner-prompts.snapshot.test.ts` exits 3/3 PASS — confirming the snapshot was regenerated after the change.

**Fix 3** — `tests/unit/planner-runtime.test.ts` lines 232–243 contain the test `'starts a stopped adapter and stops it on success'`. It pre-starts and pre-stops the adapter, verifies `state === 'stopped'` before invoking `runPlanner`, then asserts `state === 'stopped'` after. The test correctly exercises the `shouldStart = true` branch for the `stopped` initial state (mirroring the existing `idle` branch test directly above it).

**Fix 4** — `tests/unit/planner-extract.test.ts` lines 53–59 contain `'throws extract-failed on empty string input'`. The test asserts `extractJson('')` throws a `PlannerError` with `code === 'extract-failed'` and `details.snippet === ''`. The implementation in `extract.ts` trims to `''`, fails all three passes, and falls through to the final throw which sets `snippet: trimmed.slice(0, 500)` — correctly resolving to `''`.

## New Findings

None. The implementation is complete and correct as reviewed.
