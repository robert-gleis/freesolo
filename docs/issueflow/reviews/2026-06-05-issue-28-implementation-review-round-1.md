# Implementation Review — Issue #28, Round 1

## Status
pass_with_findings

## Verification commands run
- `npm test`: PASS — 40 test files, 282 tests, all green. New issue-28 suites contribute 29 tests (`state-paths` 3, `state-db` 1, `state-migrations` 2, `state-worktrees` 8, `state-drift` 6, `worktrees-command` 8, `state-build` 1) plus 1 new `cli.test.ts` registration assertion and 2 new `start-command` integration cases.
- `npm run build`: PASS — `tsc`, `copy-state-migrations.mjs`, and `ensure-bin-executable.mjs` succeed; `dist/src/state/migrations/001_worktrees.sql` is present.

## Acceptance criteria
- **Metadata survives restart** — Met. `getWorktreeStore()` opens `~/.issueflow/state.db` (or `ISSUEFLOW_STATE_DIR`), runs migrations, and `metadata survives restart` round-trips upsert → reopen → read (`tests/unit/state-worktrees.test.ts`).
- **Metadata is source of truth for ownership** — Met. `WorktreeStore` exposes upsert/get/list/delete/touch; `issueflow worktrees list` prints persisted rows; `issueflow start` upserts after worktree resolution and before session writes (`src/commands/start.ts:349-356`).
- **Drift detection (both directions)** — Met. `detectWorktreeDrift` + `loadDriftCandidates` cover `onDiskOnly` and `metadataOnly`; `issueflow worktrees drift` wires git enumeration, path-existence preflight, candidate filtering, and exit code `1` on drift.
- **Idempotent under concurrent processes** — Met in implementation. WAL + `busy_timeout=5000` (`src/state/db.ts:20-21`), `ON CONFLICT(path)` upsert preserving `created_at` (`src/state/worktrees.ts:65-71`), migration idempotency tested. Multi-process concurrency is not exercised in tests (plan self-review acknowledges this; acceptable for v1).

## Findings

1. **Minor — Start upsert integration test omits field assertions** (`tests/integration/start-command.test.ts:611-633`, plan Task 8 Step 3). The plan specified `expect(deps.upsertWorktreeMetadata).toHaveBeenCalledWith({ path, branch, agentOwner: 'cursor', issueId: 12 })` in addition to call-order checks. The implemented test only asserts `upsert` runs before `session` via a `callOrder` array and never captures the `vi.fn` on `deps` to verify payload fields. Ordering is pinned; contract fields are not.

2. **Minor — No test that `--print-only` skips metadata upsert** (`src/commands/start.ts:349`, spec Integration section). Implementation correctly guards upsert with `if (!input.printOnly)`, but no integration test asserts `upsertWorktreeMetadata` is not invoked when `printOnly: true`. Existing print-only tests use the default no-op stub without `vi.fn` spying.

3. **Minor — `deleteByPath` has no unit test** (`src/state/worktrees.ts:105-108`, spec Store operations table). Method is implemented (returns `changes > 0`) and mocked in the CLI harness, but there is no test for delete-on-existing, delete-on-missing (no-op returning `false`), or path normalization on delete.

4. **Minor — Post-build smoke test weaker than plan** (`tests/unit/state-build.test.ts`, plan Task 9 Step 1). Plan called for dynamically importing compiled `runMigrations` from `dist/src/state/migrations.js` and asserting migrations apply without "file not found" errors. The implemented test only checks that `dist/src/state/migrations/001_worktrees.sql` exists on disk. The copy script and build wiring are correct, but runtime migration resolution from compiled output is not exercised.

5. **Minor — No CLI test for `metadataOnly` drift** (`tests/unit/worktrees-command.test.ts`). Unit tests cover `metadataOnly` in `state-drift.test.ts`, and the CLI test suite covers `onDiskOnly` drift (exit `1`, human + JSON output). There is no harness test where git entries are a subset of DB rows and a stale DB path is reported as metadata-only with exit `1`.

6. **Nit — `getWorktreeStore()` opens DB connections without an explicit close path** (`src/state/index.ts:21-25`). Each factory call opens a new `better-sqlite3` handle. Acceptable for short-lived CLI invocations per spec ("once per CLI invocation"), but worth noting if future long-running processes reuse the factory.

## What looks good
- Full `src/state/` module matches spec layout: `paths`, `db`, `migrations`, `worktrees`, `drift`, barrel `index.ts`, and `001_worktrees.sql` schema with indices.
- `WorktreeStore` upsert SQL preserves `created_at` on conflict, normalizes paths via `path.resolve`, and returns the row after write. Sequential upsert idempotency and `touch` not-found error are tested.
- Migration runner reads `migrations/*.sql` beside compiled output via `import.meta.url`, skips applied versions, and wraps apply + version insert in a transaction.
- `issueflow worktrees list|drift` follow existing command patterns: injectable `WorktreesCommandDeps`, `withCommanderErrorHandling`, `--json` output, drift exit `0`/`1`/`2`, and preflight `pathExists` batching into a sync map before calling pure drift helpers.
- `issueflow start` integration: upsert is ordered before `writeSessionState`; `StateDbError` from upsert aborts the plan before session/packet writes; `startAction` maps `StateDbError` to a clear stderr message and exit `1` without launching the host (`src/commands/start.ts:490-494`).
- `ISSUEFLOW_STATE_DIR` override enables test isolation from `~/.issueflow` across path, DB, and round-trip tests.
- Build pipeline copies SQL migrations to `dist/` via `scripts/copy-state-migrations.mjs`; `better-sqlite3` and `@types/better-sqlite3` are in `package.json`.
- Drift pure functions normalize paths consistently and accept injectable `pathExists`, keeping filesystem I/O out of unit tests.

STATUS=pass_with_findings
