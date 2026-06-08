# Implementation Review Round 3 — Issue #43

**Date:** 2026-06-08
**Reviewer:** code-reviewer agent
**Branch:** issue/43-automated-pull-request-creation

## Verdict

**pass**

All three Round 2 findings are resolved. 27 PR unit tests pass with 0 failures. Three new suggestion-level observations are noted below; none are blockers or correctness issues.

---

## Round 2 Resolution Status

| Finding | Description | Status |
|---|---|---|
| R2-1 | `showAction` did not catch `PullRequestError('invalid-record', ...)` | ✅ Resolved — `pr.ts` lines 154–162 wrap `readPullRequestRecord` in a try-catch; exit code 2 with error message. Test added at `pr-command.test.ts` line 271. |
| R2-2 | Dead re-throw `if (error instanceof PullRequestError) throw error` in `pr-store.ts` | ✅ Resolved — catch block now contains only the ENOENT guard and a single `throw error`. |
| R2-3 | Unreachable `summary-unavailable` try/catch in `pr-creator.ts` | ✅ Resolved — wrapper removed; `extractSummary` is called directly. |

---

## New Findings

### S1. [Suggestion] `summary-unavailable` is an orphaned error code

**Location:** `src/integration/pr-types.ts` line 7; `src/commands/pr.ts` line 52

The Round 2 fix correctly removed the try-catch around `extractSummary`, but `summary-unavailable` was left in `PullRequestErrorCode` and in the `mapPullRequestError` switch. No code anywhere throws `new PullRequestError('summary-unavailable', ...)` — `extractSummary` throws a plain `new Error('summary-unavailable')` which would bypass the `PullRequestError` catch blocks entirely. The type union member and the switch case are therefore both dead.

This is cosmetic. If desired, remove `'summary-unavailable'` from `PullRequestErrorCode` and from the `mapPullRequestError` switch (the `default: return 2` case already handles any unmapped code correctly).

---

### S2. [Suggestion] `pr-store.test.ts` covers malformed JSON but not invalid shape

**Location:** `tests/unit/pr-store.test.ts`

The existing test at line 58 writes `{ not json` and asserts `invalid-record`. The Zod schema validation path — valid JSON with an invalid shape, e.g. `{}` — is not tested. Both branches of `parseRecord` throw `PullRequestError('invalid-record', ...)` but only the `JSON.parse` branch is exercised.

Adding a single test case with `{}` or `{ issueNumber: "not-a-number" }` would close the gap.

---

### S3. [Suggestion] `showAction` catch hardcodes exit code 2 rather than delegating to `mapPullRequestError`

**Location:** `src/commands/pr.ts` lines 154–162

`createAction` maps `PullRequestError` codes to exit codes via `mapPullRequestError`. `showAction`'s new catch block hardcodes `2`:

```ts
deps.setExitCode(2);
```

Currently this is correct: `readPullRequestRecord` can only throw `invalid-record`, and `mapPullRequestError('invalid-record')` falls to the `default: return 2` case. However, if `readPullRequestRecord` gains new error codes in the future, `showAction` would silently map all of them to 2 while `createAction` would distinguish them. Using `mapPullRequestError(error)` in `showAction` would make the two actions consistent at no cost.

---

## Notes

- The pre-existing unrelated failure (`verify-command.test.ts > records SIGINT`) is unchanged and out of scope.
- All 27 PR unit tests (4 files) pass cleanly: `pr-body`, `pr-command`, `pr-creator`, `pr-store`.
