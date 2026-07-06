# Implementation Review Round 2 — Issue #44

**Date:** 2026-06-08  
**Reviewer:** code-reviewer agent  
**Branch:** issue/44-merge-readiness-check  
**Spec:** [2026-06-08-issue-44-design.md](../specs/2026-06-08-issue-44-design.md)  
**Plan:** [2026-06-08-issue-44-plan.md](../plans/2026-06-08-issue-44-plan.md)  
**Prior review:** [2026-06-08-issue-44-implementation-review-round-1.md](./2026-06-08-issue-44-implementation-review-round-1.md)

## Verdict

**pass_with_findings**

Three of four Round 1 follow-ups are verified in production code. Acceptance criteria remain fully satisfied and integration paths pass. One newly added unit test (`syncMergePrComment`) fails due to a mock ordering bug — the implementation is correct but the claimed test fix is incomplete. Remaining Round 1 minor gaps (exit-code matrix, closed-PR persist test, spec API parity, label colours) are unchanged and non-blocking.

---

## Verification Evidence

| Check | Result |
|---|---|
| `npm test -- tests/unit/merge-*.test.ts tests/integration/merge-command.test.ts` | **38/39 pass** — 1 failure in `syncMergePrComment` test |
| `npm run build` | pass |
| `tests/unit/integration-engine-isolation.test.ts` | pass |
| `tests/unit/cli.test.ts` merge registration | pass |

---

## Round 1 Resolution Status

| # | Round 1 finding | Claimed fix | Status |
|---|---|---|---|
| 4 | `mergeEvaluateAction` evaluates twice on non–print-only runs | Removed redundant live call | ✅ **Resolved** — non–print-only path calls only `evaluateAndPersistMergeReadiness` (`src/commands/merge.ts` lines 150–155) |
| 6 | Stale-verdict bypass when `verdictRunId` is null | Fail when pass + latest run + null runId | ✅ **Resolved** — condition `(verdictRunId === null \|\| verdictRunId !== latestRun.runId)` in `merge-readiness.ts` lines 85–88 |
| 1 | `syncMergePrComment` has no unit tests | Added executor test | ⚠️ **Partial** — test added at `merge-executor.test.ts` line 176 but **fails** (see New Finding 1) |
| — | (recommended) null `verdictRunId` evaluator test | Added unit test | ✅ **Resolved** — `merge-readiness.test.ts` lines 96–99 passes |

### Round 1 items not in scope for this round (still open, non-blocking)

| # | Finding | Status |
|---|---|---|
| 2 | Evaluate exit-code matrix incomplete (gh → 3, IssueIdError → 2) | Open |
| 3 | PR-not-OPEN blocked path persistence untested at executor layer | Open |
| 5 | `buildMergeReadinessComment` signature differs from spec | Open |
| 7 | `FREESOLO_ENGINE=1` required for merge when `pr-ready` — operator docs | Open |
| 8 | Label colour constants not asserted in tests | Open |
| 9 | Integration test uses stubbed deps vs full verify → gate → pr chain | Open |

---

## Acceptance Criteria Coverage

| Criterion | Status | Evidence |
|---|---|---|
| PR blocked from merging until all gates pass | ✅ Met | `executeMerge` refuses merge when blocked; integration scenario B confirms rollback blocks merge |
| Gate state visible on the PR | ✅ Met | `syncMergePrComment` + label/JSON persist; integration happy path passes |
| Re-open after fix (stale verification / workflow rollback) | ✅ Met | Null/mismatched `verdictRunId` now fails `verification-verdict`; stale ready record re-eval on merge; integration scenario C covers `implementing` → blocked |

---

## New Findings

### Major

1. **`syncMergePrComment` unit test fails — mock does not simulate post-create ID fetch.**  
   **Location:** `tests/unit/merge-executor.test.ts`, lines 176–216.

   After posting a new comment, `syncMergePrComment` fetches the comment ID via:

   ```ts
   ['api', 'repos/.../issues/{pr}/comments', '--jq', 'last | .id']
   ```

   The test mock handles `api` + `comments` (list/search path) **before** `api` + `last` (ID fetch path). The final fetch call also contains `comments` in the URL and no `PATCH`, so the mock returns empty stdout instead of `'999'`. Assertion `expect(commentId).toBe('999')` fails with `null`.

   **Fix:** Reorder mock branches so `--jq` containing `last | .id` is matched first, or match on the exact jq string. Example:

   ```ts
   if (args[0] === 'api' && args.includes('last | .id')) {
     return { stdout: '999', stderr: '', exitCode: 0 };
   }
   if (args[0] === 'api' && args.includes('comments') && !args.includes('PATCH')) {
     return { stdout: '', stderr: '', exitCode: 0 };
   }
   ```

   The production code in `merge-executor.ts` lines 250–269 is sound; only the test harness is wrong.

### Minor

2. **Evaluate exit-code matrix still incomplete (carried from Round 1 #2).**  
   `merge-command.test.ts` covers exit `0`, `1`, `2` (no PR), and `4` (multiple labels). Missing harness cases: `MergeReadinessError` gh failure → `3`; `IssueIdError` from `resolveIssueNumber` → `2`. Low risk given shared `handleMergeError`, but plan Task 6 exit matrix not locked in.

3. **`buildMergeReadinessComment(evaluation, evaluatedAt)` still diverges from spec API (carried from Round 1 #5).**  
   Functionally correct; update spec or add optional `issueNumber` for doc parity.

4. **No executor test for blocked persist on closed/merged PR (carried from Round 1 #3).**  
   Evaluator covers `prState !== 'OPEN'`; executor-layer persist+comment path for closed PRs remains untested.

5. **Label colour constants still not asserted (carried from Round 1 #8).**  
   `MERGE_LABEL_COLORS` values correct in source; tests verify swap calls but not `--color 1D76DB` / `D93F0B`.

---

## What Looks Good

- Null `verdictRunId` stale check closes the manual-label bypass identified in Round 1; detail message includes both verdict and latest run IDs for operator debugging.
- Redundant evaluation removed from `mergeEvaluateAction` — single persist path avoids duplicate `gh pr view` and artifact reads on evaluate.
- Pure evaluator test count increased to 13 scenarios; policy toggles, stale runId, and null runId paths covered.
- Integration tests (3/3) pass including happy-path evaluate→merge and workflow rollback blocking.
- Engine isolation preserved; CLI registration intact.

---

## Recommended Follow-Ups (Non-Blocking)

1. Fix `syncMergePrComment` test mock ordering so Round 1 finding #1 is fully closed (39/39 green).
2. Add evaluate exit-code tests for gh error (`3`) and unresolved issue (`2` via `IssueIdError`).
3. Add executor test asserting blocked persist when `prState` is `CLOSED` or `MERGED`.
4. Align spec or export signature for `buildMergeReadinessComment`.
5. Assert label colour args in `merge-store.test.ts` if plan parity desired.
