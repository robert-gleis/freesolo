# Plan Review Round 2 — Issue #44

## Verdict
pass

## Summary

Round 1 drove substantive fixes across CLI exit codes, evaluator edge cases, executor re-evaluation, integration scenarios, store naming, and verification checklist. All ten major findings are addressed in the updated plan. The plan is aligned with the spec, implementable via the existing TDD task structure, and ready for execution.

## Findings

### Blocking

(none)

### Major

(none)

### Minor

1. **Evaluate exit `2` for unresolved issue is implied but not listed (plan: Task 6 Step 1; spec: CLI exit codes → evaluate).** The merge subcommand explicitly tasks `validation (no issue) → 2`, and evaluate tasks `no pull-request record → 2`. The spec groups both under evaluate exit `2`. Implementation will almost certainly share `resolveIssueNumber` (already covered in `issue-id.test.ts`), but adding one evaluate harness case for `IssueIdError` would mirror the merge line and close the last gap in the exit-code matrix.

2. **Issue-resolution CLI tests are delegated to shared core (plan: Task 6 Step 1).** The plan states resolution order (“flag → session → branch”) and wires `resolveIssueNumber` in Step 3, but unlike #35 Task 5 does not task merge-command-specific resolution tests. Acceptable given `tests/unit/issue-id.test.ts` coverage and verify-command patterns; optional hardening would be one merge-command test referencing `verify-command.test.ts` IssueIdError handling.

## Round 1 remediation summary

| Round 1 # | Severity | Status |
|---|---|---|
| 1 CLI exit-code coverage | major | **Resolved** — Task 6 Step 1 lists evaluate `0/1/2/3/4`, merge `0/1/2/3`, inline re-eval blocked → `1`, `setExitCode` harness |
| 2 `--merge-method` flag | major | **Resolved** — Task 6 Step 1 test + Step 3 wiring with default `merge` |
| 3 Issue resolution | major | **Resolved** — `resolveIssueNumber` in Step 3; resolution order documented in Step 1 (optional CLI tests: minor #2) |
| 4 Review-artifact fallback | major | **Resolved** — Task 2: default policy + `planReview` only → pass; both absent → fail |
| 5 Candidate-branch auto-skip | major | **Resolved** — Task 2: no record + matching `issue/<N>-*` head → skip under default policy |
| 6 Integration test scope | major | **Resolved** — Task 7 Scenarios A (full pipeline), B (stale verification), C (workflow rollback) |
| 7 Inline re-evaluation on merge | major | **Resolved** — Task 5: stored `ready` + gates now fail → re-eval blocks, no `gh pr merge`, record updated |
| 8 PR-not-OPEN blocked path | major | **Resolved** — Task 5: `MERGED`/`CLOSED` → blocked with labels + comment sync |
| 9 Workflow rollback re-open | major | **Resolved** — Task 7 Scenario C |
| 10 `readMergeVerdict` naming | major | **Resolved** — `readMergeLabelStatus` / `writeMergeLabelVerdict`; #29 `readVerdict` on executor deps only |
| 11 Store absolute-path join | minor | **Resolved** — Task 4 `getMergeReadinessPath` with `path.isAbsolute` guard |
| 12 Isolation verification | minor | **Resolved** — Task 8 Step 1 includes `integration-engine-isolation.test.ts` |
| 13 Label colour constants | minor | **Resolved** — Task 4 Step 1: `1D76DB` / `D93F0B` |
| 14 Production `defaultRunGh` | minor | **Resolved** — Task 5 Step 3 `defaultMergeExecutorDeps` + `execa('gh', …)` |
| 15 `merge-policy.test.ts` in file structure | minor | **Resolved** — File Structure table updated |
| 16 Task 8 session-artifact scope creep | minor | **Resolved** — vague session step removed; Task 8 is suite + build only |
| 17 `mergedAt` field | minor | **Resolved** — Task 1 types + executor success path |

## Acceptance criteria coverage (spot-check)

| Criterion | Plan coverage | Notes |
|---|---|---|
| PR blocked until all gates pass | Tasks 2, 5, 6 | Evaluator, executor blocked merge, inline re-eval, full CLI exit matrix |
| Gate state visible on the PR | Tasks 3, 5 | Comment builder + sync; PR-not-OPEN blocked path tested |
| Re-open after fix | Tasks 2, 5, 7 | Stale verdict unit tests; integration Scenarios B and C |

## Spec alignment (spot-check)

| Spec area | Plan coverage | Notes |
|---|---|---|
| Module layout (`src/integration/`, CLI, tests) | Tasks 0–7 | Matches spec architecture |
| Gate checklist + policy toggles | Task 2 | All six gates including fallback and skip paths |
| Verdict persistence (JSON, labels, comment) | Tasks 4–5 | Path helper, colours, marker-based comment sync |
| Merge execution + engine gate | Tasks 5–6 | State transition after successful `gh pr merge` only |
| CLI surface (`evaluate`, `merge`, `show`) | Task 6 | Flags, exit codes, `--print-only` |
| Integration end-to-end | Task 7 | Full prerequisite chain with fake `gh` |
| Workflow isolation | Task 8 | Guard test in full-suite verification |
| Dependency merge (#29, #43) | Task 0 | Concrete branch names and conflict guidance |

## What looks good

- Round 1 feedback was applied systematically; no major gaps remain between plan and spec.
- TDD ordering (types → pure evaluator → I/O layers → CLI → integration) is sound and matches #29/#43 conventions.
- Task 0 dependency merge with baseline verification reduces integration risk before new code lands.
- Executor tests correctly separate blocked merge, inline re-evaluation, PR-closed side effects, and engine-gated state transition.
- Store naming (`readMergeLabelStatus`, `writeMergeLabelVerdict`) cleanly separates merge labels from #29 verification verdict reads.
