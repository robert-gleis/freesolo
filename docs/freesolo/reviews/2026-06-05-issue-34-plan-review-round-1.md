# Plan Review — Issue #34, Round 1

## Status
pass_with_findings

## Summary
The plan faithfully maps the spec's domain model, module layout, acceptance criteria, and flat `tests/unit/` convention. Tasks 1–6 follow strict red/green TDD with complete, copy-runnable code; the Task 5 circular-import draft is correctly resolved via `errors.ts`, and the missing `path` import in `store.ts` is called out. The main gaps are Task 7: it breaks the plan's own TDD pattern (bullets and prose instead of concrete test code), underspecifies `plan edit` and several spec-mandated exit codes, and the store/runner test helpers use bare `mkdtemp` directories without `git init` even though `getFreesoloPath` shells out to `git rev-parse`. None are architectural blockers, but Task 7 should be tightened before an implementing agent starts.

## Findings

1. **major — Task 7 Step 1 has no concrete test code; the self-review claim "No TBD placeholders remain" is false (plan: Task 7, Step 1; Self-Review).** Tasks 2–6 and Task 8 each include full failing-test implementations. Task 7 Step 1 is a bullet checklist ("Use harness pattern from `state-command.test.ts`…") with no `buildHarness`, no `registerPlanCommands` import, and no assertions. An implementing agent must invent the entire CLI test suite from scratch, which breaks the plan's stated TDD discipline and the pattern established by every other task. Add a complete `tests/unit/plan-command.test.ts` skeleton matching `state-command.test.ts` (CapturedIo, buildHarness, vi mocks) before Step 2.

2. **major — `plan edit` tests are mentioned in prose but not specified in Task 7 Step 1 (plan: Task 7, Step 1 bullet list vs Step 3 line "`plan edit` test injects `openEditor`…").** The spec requires: read existing file, spawn editor, validate on save, restore original on validation failure, no state change. Step 1 bullets cover generate/show/approve and engine gates but never list edit. Step 3 only notes "inject `openEditor` that writes valid JSON" — no test for edit when file missing (exit 1), invalid JSON written by editor (restore + error), or successful re-validation write-back. Recommend at least three concrete edit tests in Step 1 before implementation.

3. **major — Store and runner test helpers omit `git init`; tests will fail against real `getFreesoloPath` (plan: Task 3 Step 1 `makeWorktree`; Task 6 Step 1 `makeWorktree`).** Both helpers use `fs.mkdtemp` only. Production code calls `getFreesoloPath` → `getFreesoloDir` → `execa('git', ['rev-parse', '--git-path', 'freesolo'], …)`. Every comparable test in the repo initializes git first — e.g. `verification-store.test.ts` `makeRepo()` and `issue-id.test.ts` `makeRepo()` both run `git init --quiet`. As written, store round-trip and runner happy-path tests will throw from `git rev-parse` in a non-repo temp dir, not pass as "Expected: PASS — 3 tests". Change helpers to `git init` after `mkdtemp`, matching the verification-store pattern.

4. **minor — Runner tests omit the spec's "validation failure" case (plan: Task 6 Step 1; spec: Testing → `team-planner-runner.test.ts`).** The spec lists four runner scenarios: happy path, invalid JSON, validation failure, agent contract violation. The plan covers three — validation failure (agent returns parseable JSON that fails Zod, e.g. `{ roles: [] }`) is missing. Add a fourth test with a scripted agent returning `{ "roles": [] }` and assert the error type/message the CLI will surface.

5. **minor — Task 7 omits several spec-defined exit codes (plan: Task 7 Step 1; spec: CLI Surface exit-code tables).** Spec defines: `plan show` exit `2` when no issue resolved; `plan generate` exit `4` for malformed state labels; `plan approve` exit `4` for malformed labels; both generate/approve exit `1` when issue has no `state:*` label. Step 1 bullets cover engine gate (3) and basic success/failure (1) but not 2 or 4. `state-command.test.ts` already exercises exit 4 via `MultipleStateLabelsError` / `InvalidStateLabelError` — mirror those patterns for generate and approve.

6. **minor — Top-level File Structure omits `src/planner/errors.ts` (plan: File Structure vs Task 5).** Task 5 correctly introduces `errors.ts` to break the extract/runner cycle and the self-review documents the decision, but the File Structure table at the top still lists `extract.ts` and `runner.ts` without `errors.ts`. Add it to avoid an implementer skipping the file on the first pass.

7. **minor — Task 5 extract test Step 1 vs Step 3 inconsistency (plan: Task 5, Steps 1 and 3).** Step 1 asserts `.toThrow(/invalid-json/)` (regex on message). Step 3 says "Update extract test to import `TeamPlannerError` and check `error.code === 'invalid-json'`" but does not show the revised test body. The implementing agent may leave the weak regex assertion. Show the final test using `rejects.toMatchObject({ name: 'TeamPlannerError', code: 'invalid-json' })` or equivalent.

8. **minor — Runner catch block does not map `TeamPlanValidationError` to `TeamPlannerError('validation-failed')` (plan: Task 6 Step 3 `runTeamPlanner` catch; spec: `TeamPlannerError` codes include `validation-failed`).** `parseTeamDefinition` throws `TeamPlanValidationError`; the runner re-throws it unchanged. The spec error table assigns `TeamPlanValidationError` to read/edit/approve and `TeamPlannerError` to agent/JSON failures, so this may be intentional — but the `validation-failed` code on `TeamPlannerError` is then unreachable from the runner. Either wrap schema failures in the runner (`validation-failed`) or drop that code from the error type and document that generate-time schema failures surface as `TeamPlanValidationError`. Pick one before Task 6 lands.

9. **nit — Schema tests omit empty `responsibility` edge case (plan: Task 2 Step 1; spec: Validation rules).** Tests cover empty roles, invalid host, zero count, and empty name but not empty responsibility (`z.string().min(1)`). One additional `it('rejects empty responsibility', …)` would complete spec rule coverage.

10. **nit — Self-review row "plan show/edit/approve CLI → Task 7" overstates edit coverage (plan: Self-Review table).** Edit is listed as fully mapped to Task 7, but Task 7 Step 1 does not enumerate edit scenarios. Wording fix once edit tests are added.

## What looks good

- Every acceptance criterion and spec goal in the design doc maps to a numbered task in the self-review table; spot-checking AgentAdapter planner, Zod validation, `team-plan.json` persistence, CLI subcommands, `triaged → planned`, `planned → approved`, and `FREESOLO_ENGINE` gating all land in Tasks 2–3, 6–7.
- Tasks 1–6 follow strict TDD: each has a concrete failing test file, an explicit expected failure message, minimum implementation, and a pass count. No scaffold-only code blocks in those tasks.
- The Task 5 circular-import problem (`extract.ts` importing `TeamPlannerError` from `runner.ts`) is identified inline and resolved with `src/planner/errors.ts`; runner re-exports the symbol for external consumers.
- The missing `import path from 'node:path'` in `store.ts` is explicitly noted in Task 3 Step 3 rather than left for the compiler to catch.
- Test files use the flat `tests/unit/<name>.test.ts` layout consistent with all 31 existing unit tests — no subdirectory deviation.
- Type names, Zod rules, `RunTeamPlannerInput`/`RunTeamPlannerResult` shapes, engine-gate message wording, and module paths (`getFreesoloPath` from `session-state.js`, `../../src/planner/…` imports) align with the spec and repo conventions.
- Sensible module split: `extract.ts` and `errors.ts` are reasonable extensions beyond the spec's five-file sketch without changing behaviour.
- Task 9 closes with full `npm test` and `npm run build` gates; Task 8 adds CLI registration smoke test.

STATUS=pass_with_findings
