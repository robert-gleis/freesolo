# Plan Review Round 1 — Issue #35

## Verdict
pass_with_findings

## Findings

1. **major — Task 5 omits `issueSlug` resolution required by the spec CLI contract (plan: Task 5 Step 3; spec: CLI → `create`).** `createCandidateBranch` needs `issueSlug` to call `buildCandidateBranchName` and populate provenance. The spec defines a fallback chain: `current-issue.md` in the worktree, `session.json` (`issueSlug`), then derive from the current branch `issue/<N>-<slug>`. Task 5 only parses `--issue`, `--team`, and `--branches`. An implementer has no guided path for slug resolution and will either hard-code a placeholder or skip the CLI half of acceptance criterion #3. Add an explicit `resolveIssueSlug(repoRoot, issueNumber, deps)` step (reusing `getIssueflowPath` / `session.json` patterns from `src/core/issue-id.ts` and `src/commands/plan.ts`) plus unit tests for each fallback.

2. **major — Task 5 does not list `--base` or `--force` flags (plan: Task 5; spec: CLI).** The spec documents `issueflow candidate create … [--base main] [--force]`. `--base` flows to `CreateCandidateBranchInput.baseBranch`; `--force` drives the idempotent-replace path tested in Task 4. Without explicit CLI wiring, the integrator force/recreate logic will ship without a user-facing entry point. Add both options to Step 3 and CLI tests (e.g. `--force` recreates after `already-exists`; `--base` forwarded to integrator input).

3. **major — CLI exit-code coverage is incomplete vs the spec error contract (plan: Task 5 Step 1; spec: CLI exit codes).** Spec defines: `0` created or already-exists; `1` conflict (JSON on stderr); `2` validation; `3` git operational; `show` exits `2` when no record. Task 5 Step 1 only mentions success exit `0` and conflict exit `1`. Missing tests for validation (`2`), git errors (`3`), `show` missing record (`2`), already-exists (`0`), and conflict stderr JSON shape. Mirror `plan-command.test.ts` / `verify-command.test.ts` harness patterns with `setExitCode` assertions for each code.

4. **major — Integrator error-handling scenarios from the spec error table lack dedicated tests (plan: Tasks 3–4; spec: Error Handling).** The spec defines thrown `CandidateBranchError` codes: `no-sources`, `branch-not-found`, `git-error`, and `invalid-record` (store). Tasks 3–4 cover happy path, conflict outcome, already-exists, and force, but never task tests for: zero sources before git; missing `refs/heads/<branch>` via `git rev-parse --verify`; unexpected non-zero git exit mapped to `git-error`. Add integrator test cases asserting error codes and that git is not invoked after `no-sources` / `branch-not-found` short-circuits.

5. **major — Conflict outcome fields are underspecified in implementation and test steps (plan: Task 4; spec: Merge algorithm step 7).** The spec requires `git merge --abort`, then `git diff --name-only --diff-filter=U` for `conflictedFiles`, plus `gitOutput` from merge stderr/stdout. Task 4 asserts abort and provenance `status: 'conflict'` but does not mention collecting conflicted file names or `gitOutput`. Without explicit steps, tests may only check `status` and miss acceptance criterion #2 (structured conflict report for the workflow). Extend Task 4 tests to assert `conflictedFiles`, `gitOutput`, and that `merge --abort` precedes provenance write.

6. **major — Engine isolation test deviates from established repo pattern (plan: Task 6; precedent: `planner-engine-isolation.test.ts`, `worktree-engine-isolation.test.ts`).** Task 6 proposes asserting `from '../integration` in `engine.ts` only. Existing isolation guards recursively read all `src/workflow/**/*.ts` and match imports with a module-path regex (e.g. `/integration(?:\/[^'"]*)?`). The narrow string check would miss dynamic imports, differently rooted relative paths, and violations in `policy.ts` / `kernel.ts`. Replace Step 1 with the same `listTsFiles` + regex pattern used by `planner-engine-isolation.test.ts`, substituting `integration` for `planner`.

7. **minor — Store `invalid-record` behavior is ambiguous and untested (plan: Task 2; spec: Error Handling → provenance parse failure).** Task 2 says `readCandidateBranchRecord` returns `null` on ENOENT (reasonable for “no prior candidate”), but the spec requires throwing `invalid-record` when JSON exists but fails Zod validation. The plan does not distinguish missing file vs corrupt file and has no test for malformed JSON. Add a store test with invalid JSON on disk asserting `CandidateBranchError` code `invalid-record`, following `TeamPlanValidationError` / `validateTeamPlanFile` patterns in `src/planner/store.ts`.

8. **minor — Store path helper should follow `getTeamPlanPath` absolute-path convention (plan: Task 2; precedent: `src/planner/store.ts`).** `getIssueflowPath` returns a path that may be relative to the worktree; `getTeamPlanPath` resolves via `path.isAbsolute(rawPath) ? rawPath : path.join(worktreePath, rawPath)`. Task 2 mentions `getIssueflowPath` but not this join. Without it, store read/write may fail in real git worktrees where `rev-parse --git-path` returns a relative `.git/issueflow/...` path.

9. **minor — `tests/unit/cli.test.ts` registration smoke test is not in the plan (plan: File Structure / Task 5; precedent: `cli.test.ts` for `plan`, `worktrees`, `watch`).** Every other command group added to `buildCli()` has a `registers the <group> command group` test in `cli.test.ts`. The plan modifies `src/cli.ts` but does not task updating `cli.test.ts` to assert `candidate` with `create` and `show` subcommands. Add a Step 4.5 or extend Task 5 to keep CLI registration coverage consistent.

10. **minor — Production `runGit` default is not explicitly tasked (plan: Architecture / Task 5; spec: Git runner injection).** The spec requires a production default wrapping `execa('git', args, { cwd, reject: false })` returning `{ stdout, stderr, exitCode }`. Tasks 3–4 use injectable fakes only; Task 5 says “injectable deps” but does not task a `defaultDeps.runGit` (or shared helper in `integrator.ts` / `core/git.ts`). Add an explicit Step 3 bullet wiring the execa wrapper into `CandidateCommandDeps` defaults so manual CLI invocation works without test doubles.

11. **minor — `branch-not-found` pre-merge validation is not in integrator implementation steps (plan: Task 3 Step 3; spec: Merge algorithm step 1).** Spec step 1 validates every source with `git rev-parse --verify refs/heads/<branch>` before checkout. Task 3 jumps to checkout/merge. Add an explicit validation loop in Step 3 and a fake-git test asserting rev-parse failures throw `branch-not-found` naming the missing ref.

12. **minor — Force path should assert provenance clear, not only branch recreation (plan: Task 4; spec: Merge algorithm step 4).** Spec: on `--force`, `git branch -D` (ignore missing) **and clear provenance** before retry. Task 4 says “`--force` path recreates branch” without asserting provenance deletion/overwrite. Extend the force test to verify the prior `ready` record is removed or replaced before the new merge attempt.

## Acceptance criteria coverage (spot-check)

| Criterion | Plan coverage | Gap |
|---|---|---|
| Worktree results merge cleanly into a candidate branch | Task 3 (two-source clean merge) | Adequate at integrator level; CLI end-to-end depends on finding #1 |
| Conflicts surfaced, not silently resolved | Task 4 (abort + conflict status) | Needs conflictedFiles/gitOutput detail (finding #5) |
| Candidate tied to source issue and team | Tasks 2 + 3 (provenance write) | CLI slug/team wiring incomplete (findings #1–2) |

## What looks good

- Module layout (`src/integration/`, barrel, `src/commands/candidate.ts`) matches the spec and mirrors `src/planner/`, `src/verification/`.
- Flat `tests/unit/candidate-branch-*.test.ts` naming aligns with repo convention (`tests/unit/` has no subdirectories).
- TDD task structure (Tasks 1–6) with explicit fail/pass gates and `npm test` / `npm run build` verification checklist.
- Injectable `runGit` deps and conflict-as-outcome (not thrown) match the spec domain model.
- Isolation guard is included (pattern fix needed per finding #6).
- `getIssueflowPath` for `candidate-branch.json` matches `team-plan.json` / `session.json` storage pattern.
