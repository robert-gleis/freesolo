# Implementation Review Round 2 — Issue #43

**Date:** 2026-06-08
**Reviewer:** code-reviewer agent
**Branch:** issue/43-automated-pull-request-creation

## Verdict

**pass_with_findings**

All six Round 1 findings are resolved. 37 PR unit tests pass. Three new minor/suggestion-level findings are noted below; none are blockers.

---

## Round 1 Resolution Status

| Finding | Description | Status |
|---|---|---|
| F1 | `candidate-not-ready` when `status: 'conflict'` test missing | ✅ Resolved — `pr-creator.test.ts` line 109 |
| F2 | `verification-not-passed` when run `status: 'fail'` test missing | ✅ Resolved — `pr-creator.test.ts` line 146 |
| F3 | `gh-error`, `git-error`, `already-exists` from provenance tests missing | ✅ Resolved — `pr-creator.test.ts` lines 243, 278, 295 |
| F4 | CLI exit code 3 not covered | ✅ Resolved — `pr-command.test.ts` line 125 |
| F5 | Branch-name issue resolution not tested at command layer | ✅ Resolved — `pr-command.test.ts` line 178 |
| F6 | `pr-already-exists` error code was dead code | ✅ Resolved — removed from `PullRequestErrorCode` union |

---

## New Findings

### 1. [Minor] `showAction` does not handle `invalid-record` from `readPullRequestRecord`

**Location:** `src/commands/pr.ts`, `showAction`, line 143

`readPullRequestRecord` throws `PullRequestError('invalid-record', ...)` when provenance exists but contains malformed JSON. In `createAction` this is caught by the `PullRequestError` catch block and mapped to exit code 2 via `mapPullRequestError`. In `showAction`, however, `readPullRequestRecord` is called without any try-catch:

```ts
const record = await deps.readPullRequestRecord(repoRoot);
```

A corrupt `pull-request.json` will therefore propagate as an unhandled exception rather than exiting cleanly with code 2 or printing a meaningful message.

**Fix:** Wrap the `readPullRequestRecord` call in `showAction` with a try-catch that handles `PullRequestError` the same way `createAction` does, or reuse `mapPullRequestError`. A single guard suffices:

```ts
let record: PullRequestRecord | null;
try {
  record = await deps.readPullRequestRecord(repoRoot);
} catch (error) {
  if (error instanceof PullRequestError) {
    deps.write('stderr', `${error.message}\n`);
    deps.setExitCode(2);
    return;
  }
  throw error;
}
```

---

### 2. [Minor] Redundant re-throw branch in `readPullRequestRecord`

**Location:** `src/integration/pr-store.ts`, lines 56–61

The error handler in `readPullRequestRecord` contains an `instanceof` check whose body is identical to the fallthrough:

```ts
if (error instanceof PullRequestError) {
  throw error;
}

throw error;
```

Both branches throw the same `error` reference. The `instanceof` guard is dead code and misleads readers into thinking the two paths are distinct.

**Fix:** Remove the `instanceof` check and keep only the single unconditional `throw error`.

---

### 3. [Suggestion] `summary-unavailable` is unreachable in `createPullRequest`

**Location:** `src/integration/pr-creator.ts`, lines 169–178; `src/integration/pr-types.ts`, `PullRequestErrorCode`

`extractSummary` is called with `issueNumber: input.issueNumber` and `issueSlug: candidate.issueSlug`, both of which are always defined at that point in the function (the candidate precondition has already passed). The third fallback in `extractSummary` — `Automated changes for issue #N (slug)` — will therefore always succeed, making the `throw new Error('summary-unavailable')` path in `extractSummary` and the corresponding `catch` block in `createPullRequest` unreachable in production.

This is not a bug, but `summary-unavailable` in `PullRequestErrorCode` and the catch block carry maintenance overhead with no practical effect.

**Options:**
- Leave as-is (defensive code is harmless).
- Add a JSDoc comment on the catch block explaining it is a guard for `extractSummary` callers that omit `issueNumber`/`issueSlug`.
- Extract the three-argument overload of `extractSummary` into a type so the compiler can statically guarantee the fallback path.

---

## Notes

### Pre-existing unrelated failure

`tests/integration/verify-command.test.ts > records SIGINT on the running check when a real subprocess is killed` fails with `expected 'skipped' to be 'fail'`. This test is unrelated to PR creation and was not introduced by this branch.

### What was done well

- All five precondition test scenarios (no record, conflict, no run, fail run, no review) are now covered.
- The exit-code 3 CLI path and the branch-name `resolveIssueNumber` fallback both have targeted tests.
- `pr-already-exists` dead code cleaned up cleanly.
- 37 PR unit tests pass end-to-end with real git repos and injected runners.
