# Plan Review — Issue #34, Round 2

## Status
pass_with_findings

## Summary
All eight round 1 findings called out for verification are addressed. Task 7 now includes a complete, copy-runnable `plan-command.test.ts` with harness, edit scenarios, exit codes 2/4, and 16 tests matching the self-review claim. Store and runner helpers initialize git repos; runner covers validation failure and wraps `TeamPlanValidationError`; `errors.ts` is in the file structure; extract tests assert `TeamPlannerError.code`. The plan is ready for implementation with one minor test assertion fix.

## Round 1 follow-up

1. **Task 7 has no concrete test code (major)** — **addressed.** Task 7 Step 1 (lines 742–1010) provides full `buildHarness`, `CapturedIo`, `PlanCommandDeps` mocks, and assertions for all four subcommands. Matches the `state-command.test.ts` pattern.

2. **`plan edit` tests missing (major)** — **addressed.** Three edit tests in Task 7 Step 1: successful write-back after editor (lines 905–922), missing file exit 1 (924–933), validation failure with no write-back (935–950).

3. **Store/runner helpers omit `git init` (major)** — **addressed.** Task 3 `makeWorktree` (lines 267–272) and Task 6 `makeWorktree` (lines 577–581) both run `execa('git', ['init', '--quiet'], { cwd: dir })` after `mkdtemp`, matching `verification-store.test.ts`.

4. **Runner validation failure case missing (minor)** — **addressed.** Task 6 Step 1 adds a fourth test (lines 625–635) with scripted agent returning `{ roles: [] }` and asserts `TeamPlannerError` with `code: 'validation-failed'`.

5. **Exit codes 2/4 missing from plan command tests (minor)** — **addressed.** Task 7 Step 1 includes: `plan show` exit 2 on `IssueIdError` (836–845); `plan generate` exit 4 on `MultipleStateLabelsError` (892–901); `plan approve` exit 4 on `InvalidStateLabelError` (1000–1009). Generate also tests exit 1 when state is null (883–890).

6. **`errors.ts` omitted from file structure (minor)** — **addressed.** File Structure line 19 lists `Create: src/planner/errors.ts — TeamPlannerError`.

7. **Extract test uses weak regex instead of code check (minor)** — **addressed.** Task 5 Step 1 (lines 482–489) uses `toThrow(TeamPlannerError)` plus `toMatchObject({ name: 'TeamPlannerError', code: 'invalid-json' })`.

8. **Runner does not wrap `TeamPlanValidationError` (minor)** — **addressed.** Task 6 Step 3 catch block (lines 703–705) maps `TeamPlanValidationError` → `TeamPlannerError('validation-failed', error.message)`.

**Also resolved from round 1 (not in verification checklist):**

- Empty `responsibility` schema test added (Task 2, lines 137–143).
- Self-review row updated to "16 tests incl. edit + exit codes" (line 1141).

## New findings

1. **minor — `plan approve` exit-4 test asserts wrong stderr substring (plan: Task 7 Step 1, lines 1000–1009).** The test expects `toContain('invalid workflow state label')`, but `InvalidStateLabelError` in `src/workflow/state-store.ts` emits `unrecognised workflow state label(s)`, and `state-command.test.ts` asserts `unrecognised workflow state label`. If `withCommanderErrorHandling` mirrors `state.ts` (writes `error.message` verbatim), this test will fail. Change the assertion to `unrecognised workflow state label` to match repo convention.

2. **nit — Unused import in Task 7 test skeleton (plan: Task 7 Step 1, line 753).** `InvalidTransitionError` is imported but not referenced in any test. Remove the import or add a test (e.g. `writeState` throws `InvalidTransitionError` → exit 1). Harmless at plan stage; will trip lint if left in.

3. **nit — File Structure still lists `TeamPlannerError` on `runner.ts` (plan: lines 19–21).** `errors.ts` is the canonical home; runner re-exports. Line 21 could read `runTeamPlanner, createDefaultPlannerAgent` only to avoid implementer confusion. Cosmetic.

4. **nit — `plan approve` has no null-state exit-1 test (plan: Task 7; spec: "Neither command invents state").** Generate covers `readState → null` (883–890); approve does not. Spec symmetry suggests one approve test mirroring generate. Low risk because behaviour will likely copy `state transition`; optional polish.

## What looks good

- Full TDD discipline restored: Tasks 2–8 each have concrete failing tests before implementation; Task 7 no longer breaks the pattern.
- Test count is internally consistent: 8 schema + 3 store + 1 prompt + 3 extract + 4 runner + 16 plan + 1 cli registration ≈ full suite coverage per self-review.
- Module split, type shapes, Zod rules, engine gate, JSON extraction heuristics, and persistence path all align with the spec.
- Task 5 circular-import resolution is documented inline and reflected in file structure.
- `git init` in temp worktrees matches production dependency on `getFreesoloPath` / `git rev-parse`.
- Runner error taxonomy is coherent: extract → `invalid-json`, adapter → `agent-failed`, schema → `validation-failed`.
- Task 9 retains full `npm test` and `npm run build` verification gate.

STATUS=pass_with_findings
