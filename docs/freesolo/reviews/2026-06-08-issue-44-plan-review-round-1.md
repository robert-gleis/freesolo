# Plan Review Round 1 — Issue #44

## Verdict
pass_with_findings

## Findings

### Blocking

(none)

### Major

1. **CLI exit-code coverage is incomplete vs the spec error contract (plan: Task 6 Step 1; spec: CLI exit codes, Error Handling).** The spec defines evaluate exits `0` ready, `1` blocked, `2` validation (no PR / no issue), `3` gh operational error, `4` malformed merge labels; merge exits `0` merged, `1` blocked or merge failed, `2` validation, `3` not engine-gated when a state transition is needed. Task 6 Step 1 only lists ready (`0`), blocked (`1`), `--print-only`, engine refusal (`3`), and `show` JSON output. Missing guided tests for: no pull-request record (`2`, no side effects); gh failures on evaluate (`3`); multiple `merge:*` labels (`4`, mirroring `state-command.test.ts` malformed-label cases); merge validation errors (`2`); merge blocked when inline re-evaluation still fails (`1`). Without these, the CLI half of acceptance criterion #1 and the spec error table are easy to ship incomplete. Extend Task 6 Step 1 with explicit exit-code assertions using the `setExitCode` harness pattern from `plan-command.test.ts` / `state-command.test.ts`.

2. **`--merge-method` flag is omitted from the CLI task (plan: Task 6; spec: CLI Surface, Merge execution).** The spec documents `freesolo merge [--issue <N>] [--merge-method squash|merge|rebase]` forwarding to `gh pr merge --<method>`. Task 6 never tasks parsing, defaulting, or testing the flag. Add a CLI test asserting the chosen method is forwarded to the executor/`runGh` call, and a Step 3 bullet wiring `--merge-method` into `executeMerge`.

3. **Issue resolution is not tasked for merge commands (plan: Task 6; spec: CLI → `--issue` resolution).** The spec requires the same resolution order as `freesolo verify` (flag → session → branch via `resolveIssueNumber`). Task 6 does not mention `resolveIssueNumber`, session fallback, or branch derivation tests. Other command plans (e.g. #35 Task 5) explicitly task resolution helpers and fallback tests. Add `resolveIssueNumber` wiring in Step 3 and at least one test per resolution path (or reference `verify-command.test.ts` patterns).

4. **Review-artifact gate fallback behavior is mis-specified in evaluator tests (plan: Task 2 Step 1; spec: Gate checklist → `review-artifact`).** With default policy (`requireImplementationReview: true`), the spec gate passes when `implementationReview` is absent but `planReview` exists ("if absent, fall back to `planReview`"). Task 2 only tests "Missing review artifact → fail" and "`requireImplementationReview: false` + planReview only → pass". The default-policy fallback path is untested and the "missing review artifact" case may be implemented incorrectly as always-fail. Add an evaluator test: default policy, `implementationReview: null`, `planReview` present → `review-artifact` pass; both absent → fail.

5. **Candidate-branch auto-skip path is missing from evaluator tests (plan: Task 2 Step 1; spec: Gate checklist → `candidate-branch`).** The spec skips the gate (not fails) when there is no candidate record and the PR head matches `issue/<N>-*`, even with default `requireCandidateBranch: true`. Task 2 only covers explicit fail on conflict and skip when `requireCandidateBranch: false`. Add a test: no `candidateRecord`, matching issue branch head, default policy → `candidate-branch` status `skip`, outcome still `ready` when other gates pass.

6. **Integration test scope is lighter than the spec end-to-end contract (plan: Task 7 Step 1; spec: Integration test).** The spec requires a temp repo exercising verify → gate evaluate → pr create → merge evaluate (ready) → merge succeeds, plus failing verification blocking merge and re-evaluate after a new pass restoring ready. Task 7 stubs PR record and verification state directly and only covers evaluate → merge plus stale runId refresh. That skips wiring validation across #29/#43 modules and weakens confidence in acceptance criterion #3 (re-open after fix in a realistic pipeline). Expand Task 7 to follow the spec chain (fake `gh` still acceptable) or add a second integration scenario that runs the full prerequisite commands.

7. **`executeMerge` inline re-evaluation is not tasked or tested (plan: Task 5 Step 1; spec: Merge execution step 1).** The spec says `freesolo merge` loads `merge-readiness.json` and re-runs evaluation inline when `outcome !== 'ready'` before refusing merge. Task 5 executor tests cover blocked-when-not-ready and successful merge but never assert that a stale on-disk `ready` record triggers re-evaluation and blocks when gates now fail. Add an executor test: stored record `ready`, evaluator would now return `blocked` → no `gh pr merge`, exit blocked with updated persistence.

8. **PR-not-OPEN blocked path with side effects is untested (plan: Tasks 5–6; spec: Error Handling).** The spec requires PR state not `OPEN` → exit `1` (blocked), verdict written as blocked, PR comment updated. Neither executor nor CLI tasks assert this path. Add an executor test with `prState: 'MERGED'` or `'CLOSED'` verifying persistence, label swap, and comment sync still occur with blocked outcome.

9. **Re-open semantics after workflow rollback are not covered in integration tests (plan: Task 7; spec: Acceptance criteria #3, Re-open semantics).** Acceptance criterion #3 names both stale verification and workflow rollback. Task 2 tests wrong workflow state at the unit level; Task 7 integration only exercises stale `verificationRunId`. Add an integration or executor scenario: state moves from `pr-ready` back to `implementing` (or verification fails) → `merge evaluate` returns blocked and updates comment/labels → after fix cycle returns to `pr-ready` with fresh verification → `merge evaluate` returns ready again.

10. **File-structure naming error: `readMergeVerdict` in merge-store (plan: File Structure, Task 4; spec: Verdict persistence, MergeExecutorDeps).** The plan assigns `readMergeVerdict` to `merge-store.ts`. The spec separates verification verdict reads (`readVerdict` from #29, injected via deps) from merge label writes (`writeMergeVerdict`). A store-level `readMergeVerdict` collides conceptually with #29 naming and invites implementing the wrong abstraction. Rename to something explicit (`readMergeReadinessLabels`, `detectMergeVerdictLabelConflict`) and keep verification `readVerdict` on executor deps only, matching the spec's `MergeExecutorDeps` table.

### Minor

11. **Store path helper should follow `getCandidateBranchPath` absolute-path convention (plan: Task 4; precedent: `src/integration/store.ts`).** Task 4 says path `freesolo/merge-readiness.json` but does not task `path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath)` after `getFreesoloPath`. Without it, read/write may fail when `git rev-parse --git-path` returns a relative `.git/freesolo/...` path. Add an explicit helper bullet in Task 4 Step 3.

12. **Spec-mandated isolation verification step is absent from the plan (plan: Tasks 7–8; spec: Testing Strategy → Isolation).** The spec says to extend `tests/unit/integration-engine-isolation.test.ts` (already present from #35). The plan never tasks confirming the guard still passes after adding merge modules. Add a Task 7 or Task 8 step: run `tests/unit/integration-engine-isolation.test.ts` as part of full-suite verification.

13. **Label colour constants are not tasked (plan: Task 4; spec: GitHub labels).** The spec defines `merge:ready` (`1D76DB`) and `merge:blocked` (`D93F0B`) colours on label creation/swapping. Task 4 mentions prefix `merge:` but not colours. Add a store test or implementation note ensuring `gh label create`/`gh issue edit` uses the spec colours (follow #29 `writeVerdict` label patterns post-merge in Task 0).

14. **Production default `runGh` wiring is not explicitly tasked (plan: Task 5–6; spec: Gh runner injection).** Tasks 5–6 describe injectable deps and fake runners for tests but do not task a `defaultMergeExecutorDeps.runGh` wrapping `execa('gh', …)` (same pattern as `defaultRunGit` in #35). Add a Step 3 bullet in Task 5 or Task 6 so manual CLI invocation works without test doubles.

15. **File Structure table omits `tests/unit/merge-policy.test.ts` (plan: File Structure vs Task 1).** Task 1 creates and tests `merge-policy.ts`, but the top-level File Structure table does not list the test file. Add it for parity with other tasks and with #35 plan style.

16. **Task 8 session-artifact update is vague and out of spec scope (plan: Task 8 Step 3).** "Update `freesolo/session.json` artifacts.plan path and issue packet" is not in the spec, has no acceptance criterion, and may distract implementers. Either remove or narrow to a concrete, testable session field (e.g. recording `merge-readiness.json` path in artifacts if that becomes a project convention).

17. **`mergedAt` success field mentioned in spec merge step 5 but absent from types task (plan: Task 1; spec: Merge execution step 5 vs `MergeReadinessRecord`).** The spec says "update record with `mergedAt`" on success, but the `MergeReadinessRecord` interface in the same spec omits the field. Task 1 should either add optional `mergedAt` to the Zod schema and record type or explicitly document that merge completion overwrites/extends the record per spec step 5 — otherwise implementers will skip post-merge record enrichment.

## Acceptance criteria coverage (spot-check)

| Criterion | Plan coverage | Gap |
|---|---|---|
| PR blocked until all gates pass | Tasks 2, 5, 6 (evaluator + executor blocked merge) | CLI exit codes and inline re-eval incomplete (findings #1, #7) |
| Gate state visible on the PR | Tasks 3, 5 (comment builder + sync) | PR-not-OPEN blocked-with-comment path untested (finding #8) |
| Re-open after fix | Task 2 stale verdict; Task 7 stale runId integration | Workflow rollback cycle untested (finding #9); integration lighter than spec chain (finding #6) |

## What looks good

- Task 0 dependency merge strategy is concrete: merge #29 then #43, conflict resolution notes, baseline `npm test && npm run build`, and branch names match remotes (`issue/29-verification-gate`, `issue/43-automated-pull-request-creation`).
- Module layout aligns with the spec (`merge-types`, `merge-readiness`, `merge-comment`, `merge-store`, `merge-executor`, `src/commands/merge.ts`) and extends the existing `src/integration/` barrel from #35.
- TDD task ordering is sound: policy/types → pure evaluator → comment → store → executor → CLI → integration → full verification.
- Task 2 evaluator scenarios cover most gates including stale verification and policy toggles; Task 5 executor tests correctly gate state transition on `FREESOLO_ENGINE=1` only after successful `gh pr merge`.
- `--print-only` on evaluate is explicitly tested (spec requirement).
- `tests/unit/cli.test.ts` registration smoke test is included (learned from #35 reviews).
- `MergeReadinessError` / `invalid-record` store behavior is correctly distinguished from ENOENT → null (Task 4).
