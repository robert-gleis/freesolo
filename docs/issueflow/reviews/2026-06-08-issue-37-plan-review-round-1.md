# Plan Review — Issue #37 — Round 1

## Verdict
pass_with_findings

## Findings

1. **major — Task 4 has no concrete test code or implementation steps (plan: Task 4; precedent: `2026-06-05-issue-34-plan.md` Task 7).** Tasks 1–3 each include full failing-test files, implementation code blocks, and explicit pass/fail gates. Task 4 is prose only: a bullet checklist ("Mirror `plan.ts` patterns", "Key tests: …") with no `buildHarness`, no `registerDecompositionCommands` import, no `DecompositionCommandDeps` interface, and no assertions. An implementing agent must invent the entire CLI layer from scratch, breaking the plan's stated TDD discipline. Add a complete `tests/unit/decomposition-command.test.ts` skeleton (CapturedIo, buildHarness, vi mocks) matching `plan-command.test.ts` before any implementation step, plus Step 3 with full `decomposition.ts` structure.

2. **major — `--force` on `generate` is listed in tests but not specified in CLI wiring (plan: Task 4 Key tests; spec: `decomposition generate` step 2, Open Questions).** The spec requires: reject `generate` when `decomposition-applied.json` exists (`DecompositionAlreadyAppliedError`); allow `generate --force` to overwrite the preview only when not yet applied; never regenerate after apply. Task 1 defines `DecompositionAlreadyAppliedError` but Task 4 never adds `.addOption(new Option('--force'))`, never tasks the applied-record guard in the generate handler, and has no test asserting `--force` is rejected once applied. Add explicit generate-handler steps and two concrete tests: (a) reject without `--force` when applied record exists; (b) `--force` overwrites preview when applied record is absent; (c) `--force` still rejects when applied record exists.

3. **major — Autonomous mode (`ISSUEFLOW_AUTONOMOUS=1`) is a spec goal with no implementation guidance (plan: Task 4 Key tests; spec: Goals, Autonomous auto-approve, Testing).** The spec and issue packet both require autonomous auto-approve: approve proceeds without blocking on human confirmation, same engine-authority pattern as `plan approve`. Task 4 mentions "autonomous env does not block" in a test bullet but provides no Step 3 behavior (no confirmation prompt to skip, no env-var documentation in command handler, no note that approve is callable programmatically by #45 callers). Add an explicit Task 4 bullet: approve has no interactive confirmation; `ISSUEFLOW_AUTONOMOUS=1` does not add or remove gates beyond `ISSUEFLOW_ENGINE=1`; include a test that approve succeeds with both env vars set and produces the same outcome as human approve.

4. **major — Parent body validation on approve is tested in Task 3 but not wired through approve (plan: Task 3 + Task 4; spec: Child body parent link, `decomposition approve` step 4).** Task 3 tests `ensureParentSection` in isolation and `createChildIssues` with raw bodies, but Step 2 has no implementation code and Task 4 never states that `createChildIssues` must call `ensureParentSection(body, parentIssue)` before each `gh issue create`, or that approve calls `assertParentIssueMatches(plan, issueNumber)` before creation. The `createChildIssues` test does not assert the gh `--body` arg received the prepended `## Parent\n\n#N` text. Extend Task 3 Step 2 with a full `issues.ts` implementation showing `ensureParentSection` invoked inside `createChildIssues`; extend Task 4 approve steps to call `assertParentIssueMatches` then `createChildIssues`; add an approve-level test verifying wrong-parent bodies are rejected and missing-parent bodies are prepended.

5. **major — Task 3 Step 2 omits implementation code (plan: Task 3, Step 2).** Tasks 1 and 2 each provide complete source files. Task 3 Step 2 is a single line ("Use `gh issue create …` with injectable `runGh`"). Missing: `GhRunner` type signature, `ChildIssueCreationError` class, `CreateChildIssuesInput` interface (per spec), production `defaultRunGh` wrapper, sequential-create partial-failure behavior with child index and stderr excerpt (spec Error types). Add a full `src/github/issues.ts` code block before Step 3.

6. **minor — Idempotent approve output contract is underspecified (plan: Task 4; spec: `decomposition approve` step 2, step 6).** Spec requires: if `decomposition-applied.json` exists, print existing children and exit `0`; on fresh approve, print one line per child `#<N> <title> <url>`. Task 4 mentions "approve idempotent when applied record exists" but does not task stdout format or a test asserting re-approve prints child lines without calling `createChildIssues` again. Add concrete approve tests for both paths.

7. **minor — `decomposition edit` lacks the spec's `parent_issue` match validation on save (plan: Task 4; spec: `decomposition edit`, Persistence).** Spec requires validating `parent_issue` matches the resolved `--issue` on save. `plan edit` only runs schema validation; decomposition edit must additionally call `assertParentIssueMatches(definition, issueNumber)` after `validateDecompositionFile`, and reject with exit `1` on mismatch. Task 4 mentions "parent_issue validation on save" in prose but does not list an edit test for mismatch (e.g. editor writes `parent_issue: 99` for `--issue 37`). Add at least two edit tests: successful write-back and parent mismatch rejection without overwriting the preview file.

8. **minor — `generate` success message and `fetchIssue` flow are not tasked (plan: Task 4; spec: `decomposition generate` steps 3–5; precedent: `src/commands/plan.ts`).** Spec requires printing `decomposition preview written: <path>` and fetching the issue via `gh issue view` with `current-issue.md` fallback. Task 4 says "mirror plan.ts" but does not list `fetchIssue`, `parseIssuePacket`, or `createDefaultDecompositionAgent` in `DecompositionCommandDeps`, and does not specify the success stdout string. Add deps mirroring `PlanCommandDeps` (minus workflow state) and explicit generate-handler steps.

9. **minor — Exit-code coverage incomplete vs spec and `plan-command.test.ts` (plan: Task 4; spec: CLI exit-code tables).** Spec defines exit `3` for engine gate on generate/approve, exit `1` for validation/gh errors, exit `0` for idempotent approve. `plan-command.test.ts` also covers exit `2` for `IssueIdError` on show. Task 4 key tests cover engine gate and basic success/failure but omit: show exit `2` when no issue resolved; approve exit `1` on `DecompositionValidationError` / parent mismatch; generate exit `1` on `DecompositionAlreadyAppliedError`. Mirror the plan-command exit-code matrix for decomposition commands.

10. **minor — `DecompositionAlreadyAppliedError` is defined but never tested at store or CLI level (plan: Task 1, Task 4).** Task 1 store tests cover read/write/validate/applied record but not the applied guard error class. Add a store helper test or document that the guard lives only in the CLI; prefer a CLI test in Task 4 asserting the error message and exit `1` when generate runs after apply without `--force`.

11. **minor — `ChildIssueCreationError` partial-failure scenario missing (plan: Task 3; spec: Error types, GitHub child issue creation).** Spec requires sequential creation with clear partial state on failure, `ChildIssueCreationError` including child index and stderr excerpt. Task 3 happy-path test only; no test for gh failure on the second child asserting error shape and that only one issue was attempted or that applied record is not written (approve-level concern). Add a `createChildIssues` test where `runGh` fails on child index 1.

12. **minor — No acceptance-criteria mapping table or self-review section (plan: header; spec: Acceptance Criteria Mapping).** The spec includes an explicit criteria-to-implementation table. The plan's goal/architecture sections cover the criteria implicitly but an implementing agent has no checklist to verify completeness (autonomous mode, `--force`, applied-record idempotency, parent links). Add a short self-review table before Task 5, as in `2026-06-05-issue-34-plan.md`.

## Acceptance criteria coverage (spot-check)

| Criterion | Plan coverage | Gap |
|---|---|---|
| Large issues broken into smaller child issues | Task 2 (`decomposeIssue`, min 1 child) | Adequate |
| Generated by LLM planner via `AgentAdapter` | Task 2 runner | Adequate |
| Output schema structured and validated | Task 1 store + schema | Adequate |
| Children NOT created until approval | Task 4 (approve-only gh create) | Task 4 underspecified (finding #1) |
| Parent/child links in tracker | Task 3 `ensureParentSection` | Not wired through approve (finding #4) |
| Inspectable/overridable CLI | Task 4 show/edit/approve | Task 4 lacks concrete tests (finding #1) |
| Autonomous auto-approve | Task 4 test bullet only | No implementation steps (finding #3) |
| `--force` preview regeneration | Task 4 test bullet only | No CLI wiring (finding #2) |
| Applied-record idempotency | Task 1 store + Task 4 bullet | Output contract untested (finding #6) |

## What looks good

- Module layout (`decomposition-store.ts`, `decomposition-runner.ts`, `src/github/issues.ts`, `src/commands/decomposition.ts`) matches the spec architecture and correctly keeps decomposition artifacts separate from `store.ts` / team-plan.
- Tasks 1–2 follow strict TDD with complete test files, `git init` in `makeWorktree` helpers (matching `team-plan-store.test.ts` / `plan-command.test.ts`), and path resolution via `getIssueflowPath` with absolute-path join — aligned with `src/planner/store.ts`.
- `RunIssueDecomposerInput` / `RunIssueDecomposerResult` mirror `runTeamPlanner`; `PlannerError` with code `invalid-output` matches existing `src/planner/errors.ts` conventions.
- `DecompositionAppliedRecord`, error classes (`DecompositionNotFoundError`, `DecompositionValidationError`, `DecompositionAlreadyAppliedError`), and `assertParentIssueMatches` align with spec types and persistence contract.
- Task 3 `ensureParentSection` tests cover prepend, pass-through, and wrong-parent rejection — correct domain logic, pending wiring (finding #4).
- File Structure includes `tests/unit/cli.test.ts` registration smoke test — consistent with repo precedent.
- Task 5 closes with `npm run build` and full `npm test` gates.
- Flat `tests/unit/decomposition-*.test.ts` naming matches all existing unit tests.
