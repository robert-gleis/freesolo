# Implementation Review — Issue #28, Round 2

## Status
pass

## Verification commands run
- `npm test`: PASS — 40 test files, 288 tests, all green (+6 vs round 1). Issue-28 suites: `state-paths` 3, `state-db` 1, `state-migrations` 2, `state-worktrees` 11 (+3 `deleteByPath`), `state-drift` 6, `state-build` 2 (+1 compiled migration runtime), `worktrees-command` 9 (+1 `metadataOnly` CLI, +1 cross-repo exclusion), `start-command` 18 (+1 print-only upsert guard).
- `npm run build`: PASS — `tsc`, `copy-state-migrations.mjs`, and `ensure-bin-executable.mjs` succeed; `dist/src/state/migrations/001_worktrees.sql` is present.

## Acceptance criteria
- **Metadata survives restart** — Met. Unchanged from round 1; `metadata survives restart` round-trip test still passes.
- **Metadata is source of truth for ownership** — Met. `freesolo start` upserts before session write; `freesolo worktrees list` exposes persisted rows.
- **Drift detection (both directions)** — Met. Pure `detectWorktreeDrift` / `loadDriftCandidates` tests plus CLI coverage for both `onDiskOnly` and `metadataOnly` with exit `1`.
- **Idempotent under concurrent processes** — Met. WAL + `busy_timeout`, `ON CONFLICT(path)` upsert, migration idempotency; multi-process concurrency still not exercised (acceptable per plan self-review).

## Round 1 follow-up

| Round 1 finding | Resolution |
|---|---|
| 1. Minor — Start upsert integration test omits field assertions | **Fixed.** `tests/integration/start-command.test.ts:631-636` asserts `upsertWorktreeMetadata` is called with `{ path, branch, agentOwner: 'cursor', issueId: 12 }` in addition to call-order checks. |
| 2. Minor — No test that `--print-only` skips metadata upsert | **Fixed.** `tests/integration/start-command.test.ts:640-653` spies on `upsertWorktreeMetadata` and asserts it is not invoked when `printOnly: true`. |
| 3. Minor — `deleteByPath` has no unit test | **Fixed.** `tests/unit/state-worktrees.test.ts:18-34` covers delete-on-existing (returns `true`), delete-on-missing (returns `false`), and path normalization. |
| 4. Minor — Post-build smoke test weaker than plan | **Fixed.** `tests/unit/state-build.test.ts:16-21` dynamically imports compiled `runMigrations` from `dist/src/state/migrations.js` and asserts it runs without throw on `:memory:` DB. |
| 5. Minor — No CLI test for `metadataOnly` drift | **Fixed.** `tests/unit/worktrees-command.test.ts:147-170` exercises `driftAction` with empty git entries, stale DB row, `pathExists → false`; asserts `Metadata only (missing on disk)` output and exit `1`. Bonus: `excludes rows from other repos when path still exists` (lines 172-195) guards false-positive drift for active paths outside the current repo's git list. |
| 6. Nit — `getWorktreeStore()` opens DB without explicit close | **Intentionally unchanged.** Still acceptable for short-lived CLI invocations per spec; no action required for v1. |

## Findings

None.

## What looks good
- All five actionable round-1 findings are addressed with focused tests; no regressions in the existing 282 tests.
- `createStartPlan` integration coverage now pins both upsert payload contract and print-only guard, matching spec Integration and Testing sections.
- `WorktreeStore.deleteByPath` behaviour (boolean return, path normalization) is tested alongside existing upsert/touch/list coverage.
- Compiled-output migration smoke test closes the dist copy-script ↔ runtime resolution loop that round 1 identified as untested.
- CLI drift harness now mirrors pure-function coverage for both drift directions plus the cross-repo false-positive exclusion path.
- Core implementation (`src/state/`, `src/commands/worktrees.ts`, `src/commands/start.ts` upsert hook) unchanged in substance; fixes are test-only additions aligned with the plan.

STATUS=pass
