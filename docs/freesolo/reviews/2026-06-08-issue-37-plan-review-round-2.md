# Plan Review — Issue #37 — Round 2

**Spec:** `docs/freesolo/specs/2026-06-08-issue-37-design.md`
**Plan:** `docs/freesolo/plans/2026-06-08-issue-37-plan.md`
**Prior review:** `docs/freesolo/reviews/2026-06-08-issue-37-plan-review-round-1.md`

## Verdict

**pass**

All five round-1 major findings are resolved in substance. Remaining gaps are minor polish items that do not block implementation.

---

## Round 1 Resolution Check

| # | Severity | Finding | Status | Notes |
|---|----------|---------|--------|-------|
| 1 | major | Task 4 lacks concrete test code and implementation steps | **Partially resolved (minor remains)** | Task 4 now lists `DecompositionCommandDeps`, full handler steps for all four subcommands, and a comprehensive test checklist. Step 1 still has comment-only test stubs (no `buildHarness`, no runnable assertions) — weaker than `2026-06-05-issue-34-plan.md` Task 7 but mitigated by in-repo `plan-command.test.ts` precedent. Downgraded to minor. |
| 2 | major | `--force` on `generate` not wired | **Resolved** | Generate handler steps 1–3 specify applied-record guard, `--force` overwrite when not applied, and reject-with-`--force` when applied. Test checklist covers all three scenarios. |
| 3 | major | Autonomous mode (`FREESOLO_AUTONOMOUS=1`) missing guidance | **Resolved** | Approve handler explicitly states no interactive confirmation; `FREESOLO_AUTONOMOUS=1` does not add or remove gates beyond `FREESOLO_ENGINE=1`. Test bullet included. Matches `plan approve` (no autonomous env check in `src/commands/plan.ts`). |
| 4 | major | Parent body validation not wired through approve | **Resolved** | Task 3 provides full `issues.ts` with `ensureParentSection` invoked inside `createChildIssues`; test asserts `--body` arg contains `## Parent` / `#37`. Task 4 approve calls `assertParentIssueMatches` then `createChildIssues`. |
| 5 | major | Task 3 Step 2 omits implementation code | **Resolved** | Full `src/github/issues.ts` code block: `GhRunner`, `ChildIssueCreationError`, `ensureParentSection`, `defaultRunGh`, sequential create with child-index error. |
| 6 | minor | Idempotent approve output underspecified | **Resolved** | Approve handler steps 1 and 5 specify `#<N> <title> <url>` output for both idempotent and fresh paths. Test bullets cover idempotent path without calling `createChildIssues`. |
| 7 | minor | `decomposition edit` parent_issue validation | **Resolved** | Edit handler calls `validateDecompositionFile` then `assertParentIssueMatches`; test bullet for mismatch without overwrite. |
| 8 | minor | `generate` success message and `fetchIssue` flow | **Resolved** | `fetchIssue` in `DecompositionCommandDeps`; generate prints `decomposition preview written: <path>\n`. |
| 9 | minor | Exit-code coverage incomplete | **Resolved** | Test checklist covers exit `2` (IssueIdError), `3` (engine gate), `1` (validation/applied/gh errors), `0` (success/idempotent). |
| 10 | minor | `DecompositionAlreadyAppliedError` untested | **Resolved** | CLI test bullet: generate after apply without `--force` → exit `1`. Guard correctly lives in CLI, not store. |
| 11 | minor | `ChildIssueCreationError` partial-failure test | **Resolved** | Task 3 test asserts `childIndex: 0` on gh failure. Applied record not written is implicit (approve calls `writeDecompositionApplied` only after `createChildIssues` returns). |
| 12 | minor | No acceptance-criteria self-review | **Resolved** | `Acceptance Criteria Self-Review` table added before Task 5. |

---

## New Findings (Round 2)

### Minor

1. **Task 4 Step 1 still not runnable as a failing test (plan: Task 4, Step 1).** Imports and a test checklist are present, but `buildHarness`, `CapturedIo`, and concrete `it(...)` blocks with assertions are absent. An implementing agent must copy structure from `tests/unit/plan-command.test.ts`. Acceptable given in-repo precedent; add a note in Step 1 pointing to that file as the copy source to reduce ambiguity.

2. **`createDecompositionAgent` vs `createDefaultDecompositionAgent` naming mismatch (plan: Task 2 Step 3, Task 4 deps).** Task 2 exports `createDefaultDecompositionAgent`; Task 4 deps list `createDecompositionAgent`. Align names (prefer `createDecompositionAgent` in deps aliasing `createDefaultDecompositionAgent`, matching `createPlannerAgent` / `createDefaultPlannerAgent` in `plan.ts`).

3. **Generate `--force` + applied-record error type unspecified (plan: Task 4 generate step 2).** When applied record exists and caller passes `--force`, handler rejects but does not name the error class. Use `DecompositionAlreadyAppliedError` (or a distinct message) for consistency with step 1.

4. **No explicit `.addOption(new Option('--force'))` wiring note (plan: Task 4 Step 3).** Handler logic covers `--force` behaviour; add one implementation bullet on the `generate` subcommand registration, matching Commander patterns elsewhere in the repo.

5. **Approve-level wrong-parent-body rejection not in test checklist (plan: Task 4).** Task 3 unit-tests `ensureParentSection`; consider one approve integration test where preview child body references `#99` for `--issue 37` → exit `1`, no `createChildIssues` call. Optional given Task 3 coverage.

6. **Regenerate without `--force` when preview exists (no applied record) unspecified (plan: Task 4 generate; spec: Open Questions).** Spec emphasises `--force` to overwrite preview when not applied; plan only guards on applied record. Behaviour when `decomposition.json` exists but `decomposition-applied.json` does not — allow silent overwrite or require `--force` — is implicit. Low risk: default `runIssueDecomposer` overwrites; document in Step 3 or match spec wording.

---

## Spec Alignment Spot-Check

| Criterion | Plan coverage | Assessment |
|-----------|---------------|------------|
| Smaller child issues via `decomposeIssue` | Task 2 | Adequate |
| `AgentAdapter` planner path | Task 2 | Adequate |
| Schema validation | Task 1 | Adequate |
| Preview-first; approve creates children | Tasks 3–4 | Adequate |
| Parent links in child bodies | Task 3 `ensureParentSection` + Task 4 approve | Adequate |
| CLI show/edit/approve/generate | Task 4 | Adequate (minor: Step 1 test stubs) |
| Autonomous auto-approve | Task 4 approve handler | Adequate |
| `--force` preview regeneration | Task 4 generate handler | Adequate |
| Applied-record idempotency | Tasks 1 + 4 | Adequate |
| `FREESOLO_ENGINE` gate on generate/approve | Task 4 | Adequate |
| No workflow state machine changes | Architecture header | Adequate |

---

## Codebase Feasibility

Verified against current repo:

- `decomposeIssue`, `decompositionPlanSchema`, and `ScriptedAgentAdapter` exist and are tested (`src/planner/runtime.ts`, `tests/unit/planner-runtime.test.ts`).
- `getFreesoloPath` pattern in Task 1 matches `src/planner/store.ts`.
- `PlanCommandDeps` / `plan-command.test.ts` provide a direct mirror for Task 4 CLI structure.
- `src/github/` does not exist yet; plan correctly creates `src/github/issues.ts`.
- `RepoRef` import from `workflow/state-store.js` matches `plan.ts` convention.

No architectural blockers identified.

---

## What Looks Good

- Tasks 1–3 are fully TDD-ready with complete test files, implementation blocks, and pass/fail gates.
- Module layout matches spec and keeps decomposition artifacts separate from team-plan `store.ts`.
- `RunIssueDecomposerInput` mirrors `runTeamPlanner`; `PlannerError('invalid-output')` matches existing error conventions.
- Task 3 `createChildIssues` uses `--json number,url,title`, sequential creation, and child-index errors per spec.
- Acceptance Criteria Self-Review table gives implementers a completion checklist.
- Task 5 closes with `npm run build` and full `npm test`.

---

## Recommendation

Proceed to implementation. Address minor findings inline during Task 4 (especially `buildHarness` copy-from-`plan-command.test.ts` and agent dep naming). No plan revision round required.
