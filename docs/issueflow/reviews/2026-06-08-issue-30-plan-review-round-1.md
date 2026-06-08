# Plan Review Round 1 — Issue #30

## Verdict
pass_with_findings

## Findings

1. **major — Verify hook DI and test placement contradict each other and the #20 precedent (plan: Task 6 Steps 1–2; spec: verify hook; precedent: `src/commands/verify.ts`, `tests/unit/verify-command.test.ts`).** Task 6 extends `VerifyPlanDeps` with `writeTestReport` and Step 1 tests it via `createVerifyPlan` injection, but Step 2 says to call the hook from `verifyAction`, which accepts no deps and is not unit-tested today. An implementer who follows Step 2 will fail Step 1; one who follows Step 1 contradicts Step 2. Align with the spec (“after `createVerifyPlan` returns `mode: 'completed'`”) and the established verify pattern: invoke inside `createVerifyPlan` before returning the completed result (so deps are testable), or introduce `VerifyActionDeps`, thread `defaultVerifyPlanDeps.writeTestReport` through `verifyAction`, and add a `verifyAction` test for the glue.

2. **major — Review round artifact scan pattern omits the date prefix used in production (plan: Task 3 Step 3; spec: REVIEW_REPORT rules; precedent: `review-loop.mjs` `datedReviewArtifact`, `src/core/artifacts.ts` `findLatestReviewArtifact`).** On-disk files are `YYYY-MM-DD-issue-<N>-<kind>-review-round-<R>.md`. Task 3 describes scanning for `issue-<N>-<kind>-review-round-<R>.md` without the leading date segment. Step 1 fixtures correctly use dated names, but the implementation step text would lead an implementer to a glob that matches nothing. Use `*issue-<N>-<kind>-review-round-<R>.md` (same `includes(issueMarker)` approach as `findLatestReviewArtifact`) and add a test with dated filenames only.

3. **major — Spec-mandated integration test is missing from the plan (spec: Testing Strategy → Integration; plan: File Structure, Task 9).** The spec requires `tests/integration/reports-command.test.ts` — temp repo, reports on disk, `issueflow reports show --issue N --json` returns paths. The plan lists only unit tests and Task 9 runs `npm test` without adding this file. Precedent: `tests/integration/verify-command.test.ts`. Add an explicit task step and file-table row.

4. **major — `TEST_REPORT.md` builder steps are incomplete vs the spec format (plan: Task 2; spec: TEST_REPORT.md format + cancelled runs).** The spec requires a `## Run metadata` section (Started/Finished), log cells showing basename plus a relative path from `runDirectory` when possible, and SIGINT-cancelled runs still writing a report with `status: fail` reflecting recorded check states. Task 2 only tasks frontmatter, checks table, and log basename. Add implementation bullets and tests for metadata, relative log paths, and a cancelled-run fixture.

5. **major — Report write failure must not change verify exit code — stated but not tested (plan: Task 6 Step 2; spec: verify hook, Error Handling).** Step 2 mentions wrapping the default `writeTestReport` in try/catch with stderr logging, but no step asserts that a throwing stub leaves `exitCode` at 0, 1, or 130. The spec treats report generation as best-effort. Add a `createVerifyPlan` (or `verifyAction`) test where `writeTestReport` rejects and `result.exitCode` is unchanged.

6. **major — `pass_with_findings` / `block` must not emit `REVIEW_REPORT.md` — no negative test (plan: Task 7; spec: review-loop hook).** Self-Review Notes acknowledge the spec rule; Task 7 Step 1 only covers `record-review --status pass`. Extend `review-loop-script.test.ts` to assert `pass_with_findings` (existing test at round 1) and `block` (round 5 path) do not create `.git/issueflow/reports/issue-*/REVIEW_REPORT.md` and leave `artifacts.reviewReport` unset.

7. **minor — `updateSessionReportArtifact` should use `worktreePath`, not `repoRoot` (plan: Task 4; spec: session update; precedent: `writeSessionState(worktreePath, …)`, `getIssueflowPath(worktreePath, …)`).** `getIssueflowPath` is defined against the worktree cwd. Linked worktrees can diverge `session.worktreePath` from `session.repoRoot`. Read session first and pass `session.worktreePath` (or rename the parameter to match `writeSessionState`).

8. **minor — `getIssueReportsDir` should explicitly task relative-path resolution (plan: Task 4 Step 3; precedent: `src/verification/store.ts` `gitIssueflowPath`).** Verification store joins `path.join(repoRoot, resolved)` when `rev-parse --git-path` returns a relative path. The plan says “like verification store” but the snippet only shows `execa`. Without the join step, report writes may fail in real worktrees.

9. **minor — Spec error-handling table scenarios lack dedicated tests (spec: Error Handling; plan: Tasks 3–4, 7).** Untasked: unwritable reports directory (warn, no exit change); review artifact missing on disk (`artifact missing` note); session missing during artifact update (skip session, still write file); malformed review markdown (`findingsCount: 'unknown'`). Task 3 introduces `parseReviewArtifactSummary` but only happy-path fixtures.

10. **minor — `REVIEW_REPORT.md` round detail and per-round gate status underspecified (plan: Task 3; spec: REVIEW_REPORT format).** Spec table includes a Gate status column (e.g. `pass_with_findings`) and per-round subsections with a verdict excerpt. Task 3 asserts row count and `_Not started._` but not gate-status cells or excerpt text. Add assertions for verdict parsing and round subsection content.

11. **minor — Reports CLI human summary format not tested (plan: Task 8; spec: CLI Output).** Spec requires one-line summaries (`test: pass, 3/3 checks` / `review: plan pass, implementation pending`). Task 8 tests `not generated yet` and JSON shape only. Add stdout assertions for the human format when reports exist.

12. **minor — Script bridge filename diverges from spec architecture diagram (spec: `write-review-report.mjs`; plan: `generate-review-report.mjs` + `generate-review-report.ts`).** Behaviour is equivalent if the dist entry is documented, but the rename adds friction when cross-referencing the spec during implementation. Prefer spec naming or note the alias explicitly in Task 7.

13. **minor — Task 6 default dep snippet shadows `writeTestReport` (plan: Task 6 Step 2).** The default implementation `async (run) => { const path = await writeTestReport(run); … }` uses the same identifier for the dep and the store import. Rename the import (e.g. `writeTestReportToDisk`) in the plan snippet to avoid implementer copy-paste bugs.

## Acceptance Criteria (table)

| Criterion | Plan coverage | Gap |
|---|---|---|
| Reports generated automatically at end of relevant step | Task 6 (`verify` hook), Task 7 (`record-review --status pass`) | Verify DI ambiguity (finding #1); `TEST_REPORT` cancelled-run coverage (finding #4); negative review-loop tests (finding #6) |
| Reports attached to workflow (retrievable by issue id) | Tasks 4–5 (session + `findIssueArtifacts`), Task 8 (`reports show`) | Integration test omitted (finding #3); session path param (finding #7) |
| Format stable for humans and agents | Tasks 1–3 (`schemaVersion: 1`, fixed sections), Task 2/3 builders | `TEST_REPORT` metadata + log paths (finding #4); review table/excerpt detail (finding #10); error-row fallbacks (finding #9) |

## Plan & Spec Alignment (table)

| Spec area | Plan mapping | Alignment |
|---|---|---|
| `src/reports/` module layout | Tasks 1–4, 9 | Aligned; adds `session-artifacts.ts` and `generate-review-report.ts` beyond spec diagram (reasonable) |
| `TEST_REPORT.md` hook in verify | Task 6 | Partial — hook placement/DI unclear (finding #1); format incomplete (finding #4) |
| `REVIEW_REPORT.md` hook on `pass` only | Task 7 | Aligned for happy path; negative cases untested (finding #6) |
| `.git/issueflow/reports/issue-<N>/` storage | Task 4 `getIssueReportsDir` | Aligned; relative-path join should be explicit (finding #8) |
| Session `artifacts.testReport` / `reviewReport` | Tasks 4–5 | Aligned; `worktreePath` convention (finding #7) |
| `findIssueArtifacts` extension | Task 5 | Aligned |
| `issueflow reports show [--issue] [--json]` | Task 8 | Aligned; human output tests thin (finding #11) |
| `--print-only` skips report | Task 6 Step 1 | Aligned |
| Report failure does not change exit codes | Task 6 Step 2 (verify), Task 7 Step 4 (review-loop warn) | Partial — verify case untested (finding #5) |
| Unit test matrix | Tasks 1–8 file table | Mostly aligned |
| Integration test | Spec only | Missing from plan (finding #3) |
| Review artifact glob | Task 3 `listReviewRoundArtifacts` | Misaligned pattern text (finding #2) |
| `review-loop.mjs` subprocess bridge | Task 7 | Aligned with Option A; filename differs (finding #12) |
| No placeholders / TBD | Full plan read | Aligned — no TBD or placeholder steps found |
