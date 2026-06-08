# Implementation Review Round 1 — Issue #43

**Date:** 2026-06-08
**Reviewer:** code-reviewer agent
**Branch:** issue/43-automated-pull-request-creation

## Verdict

**pass_with_findings**

All three acceptance criteria are satisfied, all 30 tests pass, the build is clean, and the workflow isolation guard holds. Six findings are noted — none are blockers, but findings 1–3 represent plan-specified test scenarios that were not implemented.

---

## Findings

### 1. [Important] Missing test: `candidate-not-ready` when `status: 'conflict'`

**Location:** `tests/unit/pr-creator.test.ts`

The plan (Task 4, Step 1) specifies a test for the case where a candidate record exists but has `status: 'conflict'`. Only the "no candidate record" path is covered. The creator's precondition (`candidate.status !== 'ready'`) handles this correctly in production, but test coverage is absent.

**Fix:** Add a test that seeds a candidate record with `status: 'conflict'` and asserts `code: 'candidate-not-ready'`.

---

### 2. [Important] Missing test: `verification-not-passed` when run `status: 'fail'`

**Location:** `tests/unit/pr-creator.test.ts`

The plan (Task 4, Step 1) specifies a test for a failing run. Only the "no run" path is covered. The logic is correct (`verificationRun.status !== 'pass'`), but the "run exists but failed" branch is untested.

**Fix:** Add a test that writes a run with `status: 'fail'` and asserts `code: 'verification-not-passed'`.

---

### 3. [Important] Missing tests: `gh-error`, `git-error`, and `already-exists` from provenance record

**Location:** `tests/unit/pr-creator.test.ts`

The plan (Task 5, Step 1) lists five happy/error scenarios for the create path. Only two are implemented (happy path and `already-exists` from `gh pr list`). Three are absent:

- `already-exists` when a provenance record already exists for the same issue/head
- `gh-error` when `gh pr create` exits non-zero
- `git-error` when `git push` fails

These paths exist in production and the injection points make them straightforward to test.

**Fix:** Add the three missing creator test cases as described in plan Task 5.

---

### 4. [Minor] Missing CLI exit-code coverage for `gh-error`/`git-error` (exit code 3)

**Location:** `tests/unit/pr-command.test.ts`

`mapPullRequestError` maps `gh-error` and `git-error` to exit code 3, but `pr-command.test.ts` only exercises exit codes 0, 1, and 2. Exit code 3 is reachable and tested nowhere.

**Fix:** Add one `createAction` test that injects a `PullRequestError('gh-error', ...)` rejection and asserts `io.exitCode === 3`.

---

### 5. [Minor] Branch-name issue resolution not tested in `pr-command.test.ts`

**Location:** `tests/unit/pr-command.test.ts`

The plan (Task 6, Step 1) specifies tests for all three `resolveIssueNumber` fallbacks. Only the session.json path is tested with a real resolver; the branch-name fallback (`issue/<N>-<slug>`) has no coverage at the command layer.

**Fix:** Add a test that mocks the current branch name to `issue/43-some-slug` and asserts the issue number is resolved correctly.

---

### 6. [Suggestion] `pr-already-exists` error code is defined but never thrown

**Location:** `src/integration/pr-types.ts`, line 7

`'pr-already-exists'` is declared in `PullRequestErrorCode` but the creator returns `{ status: 'already-exists' }` rather than throwing. The enum entry is dead code that could mislead future contributors into expecting an exception.

**Fix:** Either remove `'pr-already-exists'` from the union or add a JSDoc comment clarifying it is reserved for future use (e.g., if the create path is ever refactored to throw instead of returning).

---

## Notes

### Acceptance criteria

| Criterion | Status |
|---|---|
| PR created automatically against candidate branch | ✅ Implemented via `createPullRequest` + `gh pr create --base --head` |
| PR body includes summary, test results, review results | ✅ `buildPullRequestBody` assembles all three sections per spec |
| PR linked to originating issue | ✅ `Closes #<issueNumber>` footer in body |

### What was done well

- **Architecture exactly mirrors the spec.** `pr-types.ts`, `pr-body.ts`, `pr-store.ts`, `pr-creator.ts`, and `src/commands/pr.ts` map 1:1 to the file structure table in the design.
- **Injection is clean.** `PullRequestCreatorDeps` covers all I/O surfaces; tests never touch the network or filesystem in unit-test creator scenarios.
- **Idempotency is correctly layered.** Provenance-record check runs before `gh pr list`, so the fast path avoids a network call on re-runs.
- **Temp-file body strategy is correct.** Using `--body-file` with `finally`-cleanup handles bodies that contain special shell characters reliably.
- **Zod validation on read.** `pullRequestRecordSchema.safeParse` guards against corrupted provenance at parse time with a typed `PullRequestError`.
- **Workflow isolation preserved.** `integration-engine-isolation.test.ts` passes — no `src/workflow/` coupling introduced.
- **CLI smoke test added.** `cli.test.ts` includes the `pr` command group registration check as planned.
- **Build clean.** `npm run build` produces zero TypeScript errors.

### Summary

The implementation is solid and production-ready. The six findings are all in test coverage, not production behaviour. Findings 1–3 cover scenarios where the production guard logic already exists but is exercised only implicitly through the happy path. Addressing them before merge is recommended to avoid coverage gaps that could regress silently on a future refactor of the precondition chain.
