# Implementation Review Round 1 — Issue #44

**Date:** 2026-06-08  
**Reviewer:** code-reviewer agent  
**Branch:** issue/44-merge-readiness-check  
**Spec:** [2026-06-08-issue-44-design.md](../specs/2026-06-08-issue-44-design.md)  
**Plan:** [2026-06-08-issue-44-plan.md](../plans/2026-06-08-issue-44-plan.md)

## Verdict

**pass_with_findings**

The merge readiness gate is implemented end-to-end: pure evaluator, JSON + label persistence, PR comment sync, and `freesolo merge evaluate|merge|show` CLI. All three acceptance criteria are satisfied. Merge-specific tests (37) pass; `npm run build` succeeds. Findings below are test-coverage gaps and minor polish — none block merge or invalidate the gate contract.

---

## Verification Evidence

| Check | Result |
|---|---|
| `npm test -- tests/unit/merge-*.test.ts tests/integration/merge-command.test.ts` | 37/37 pass |
| `npm run build` | pass |
| `tests/unit/integration-engine-isolation.test.ts` | pass (workflow does not import `src/integration/`) |
| `tests/unit/cli.test.ts` merge registration | pass |

---

## Acceptance Criteria Coverage

| Criterion | Status | Evidence |
|---|---|---|
| PR blocked from merging until all gates pass | ✅ Met | `evaluateMergeReadiness` aggregates six gates; `executeMerge` refuses `gh pr merge` when `outcome !== 'ready'`; CLI exits `1` with `nextAction` |
| Gate state visible on the PR | ✅ Met | `evaluateAndPersistMergeReadiness` writes `merge:*` labels + JSON; `syncMergePrComment` posts/updates markdown checklist with `<!-- freesolo-merge-readiness -->` marker |
| Re-open after fix (stale verification / workflow rollback) | ✅ Met | Stale `verdictRunId` fails `verification-verdict`; unit + integration tests cover stale run refresh and `implementing` → blocked evaluate |

---

## Plan / Spec Alignment (Spot-Check)

| Area | Status | Notes |
|---|---|---|
| Module layout (`src/integration/`, `src/commands/merge.ts`) | ✅ | Matches spec architecture |
| Six-gate checklist + policy toggles | ✅ | All gates implemented; fallback/skip paths match spec |
| Verdict persistence (JSON, labels, comment) | ✅ | Zod schema v1; label swap via `writeMergeLabelVerdict`; colours `1D76DB` / `D93F0B` in code |
| CLI surface (`evaluate`, `merge`, `show`) | ✅ | Registered in `cli.ts`; `--print-only`, `--merge-method`, `--issue` |
| Injectable `gh` runners | ✅ | `MergeExecutorDeps.runGh`, store `GhRunner`, unit/integration fakes |
| Engine-gated state transition after successful merge | ✅ | `executeMerge` calls `writeState(pr-ready → merged)` only when `engineEnabled && gh` succeeds |
| Dependency modules (#29, #43) | ✅ | Uses `readVerdict`, `readGateVerdictRecord`, `readPullRequestRecord`, etc. |

---

## Findings

### Blocking

(none)

### Major

(none)

### Minor

1. **`syncMergePrComment` has no unit tests (plan: Task 5 Step 1).**  
   `merge-executor.test.ts` covers persist, blocked merge, inline re-eval, and successful merge, but never asserts comment create/update behaviour (PATCH via stored `prCommentId`, marker search, or `pr comment` fallback). The function is exercised indirectly through `mergeEvaluateAction`, yet the plan explicitly tasks dedicated executor scenarios. Add tests with a fake `runGh` capturing `api` / `pr comment` calls.

2. **Evaluate exit-code matrix incomplete vs plan (plan: Task 6 Step 1).**  
   Implemented handlers exist for gh errors (`MergeReadinessError` → exit `3`) and multiple labels (`MultipleMergeLabelVerdictsError` → exit `4`), but `merge-command.test.ts` only tests exit `4`. Missing harness cases: gh failure on evaluate → `3`; unresolved issue (`IssueIdError`) → `2`. Low risk given shared `handleMergeError` and `issue-id.test.ts`, but the plan exit-code matrix is not fully locked in.

3. **PR-not-OPEN blocked path persistence untested at executor layer (plan: Task 5 Step 1).**  
   `merge-readiness.test.ts` asserts evaluator blocks on `prState: 'MERGED'`, but no executor test verifies that `evaluateAndPersistMergeReadiness` still writes blocked labels/JSON (and would sync comment) for closed/merged PRs. Behaviour is likely correct via shared persist path; test gap only.

4. **`mergeEvaluateAction` evaluates twice on non–print-only runs (`src/commands/merge.ts`).**  
   Flow calls `evaluateMergeReadinessLive` then `evaluateAndPersistMergeReadiness`, which re-gathers inputs and re-evaluates. Correct verdict, redundant I/O (duplicate `gh pr view`, artifact reads). Consider skipping the first live call and using persist path only, or having persist accept a precomputed evaluation.

5. **`buildMergeReadinessComment` signature differs from spec API.**  
   Spec documents `buildMergeReadinessComment(evaluation, issueNumber)`; implementation uses `(evaluation, evaluatedAt)`. Functionally correct (timestamp from record), but public barrel export diverges from design doc. Update spec or add optional `issueNumber` parameter for doc parity.

6. **Stale-verdict bypass when `verdictRunId` is null (`merge-readiness.ts`).**  
   Stale check requires `verdictRunId !== null`. If GitHub carries `verdict:pass` label but `gate-verdict.json` is missing/`runId` null while a newer verification run exists, `verification-verdict` passes. Unlikely in normal `gate evaluate` flow (gate always sets `runId` when a run exists), but a manually labelled issue could slip through. Consider failing when `verdict === 'pass'` and `latestRun` exists but `verdictRunId` is null or mismatched.

7. **`FREESOLO_ENGINE=1` required for entire merge when state is `pr-ready` (plan-aligned, spec-ambiguous).**  
   `mergeExecuteAction` exits `3` before `gh pr merge` when `state === 'pr-ready'` and engine flag unset. Plan Task 6 requires this; spec merge-execution section describes engine gating only for the state transition step. Implementation follows plan and tests; document operator expectation that manual merge also requires engine flag while in `pr-ready`.

8. **Label colour constants not asserted in tests (plan: Task 4 Step 1).**  
   `MERGE_LABEL_COLORS` values are correct in source; `merge-store.test.ts` verifies label swap calls but not `--color 1D76DB` / `D93F0B` arguments.

9. **Integration test uses stubbed deps rather than full verify → gate → pr chain (plan Task 7 vs spec Integration test).**  
   Scenarios A/B/C cover evaluate/merge semantics with injected state, which satisfies acceptance criteria. Spec’s fuller prerequisite command chain is not exercised; acceptable for v1 given fake-gh constraints, but weaker cross-module wiring confidence.

---

## What Looks Good

- Pure `evaluateMergeReadiness` is well-factored with explicit gate IDs, `nextAction` map, and thorough unit coverage (12 scenarios including fallback, skip, policy toggles, stale verdict).
- Store layer mirrors #29 patterns: Zod validation, `getMergeReadinessPath` absolute-path guard, `MultipleMergeLabelVerdictsError`.
- `executeMerge` correctly re-evaluates stale on-disk `ready` records, transitions workflow state only after successful `gh pr merge`, and sets `mergedAt`.
- CLI exit codes for ready/blocked/no-PR/print-only/engine gate/multiple labels are wired and tested.
- Barrel exports in `src/integration/index.ts` expose the merge surface cleanly.
- Workflow engine isolation preserved — no `src/workflow/` imports of integration modules.

---

## Recommended Follow-Ups (Non-Blocking)

1. Add `syncMergePrComment` unit tests with fake `runGh`.
2. Close evaluate exit-code test gaps (`3`, `2` for `IssueIdError`).
3. Remove redundant live evaluation in `mergeEvaluateAction`.
4. Add executor test for blocked persist on `prState: 'CLOSED'|'MERGED'`.
5. Tighten stale-verdict logic when `verdictRunId` is null but `latestRun` exists.
