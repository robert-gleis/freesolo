# Plan Review — Issue #23, Round 1

## Status
pass_with_findings

## Summary
The plan covers all four GitHub acceptance criteria and tracks the spec's module layout, eight event types, migration version 2 schema, append/list API, and concurrency test file list. TDD is strong in Tasks 1–2 (full red/green code blocks) but weakens from Task 3 onward. The most important fix before implementation is a contradiction in migration registration: Task 2 appends `eventsMigration` to `BASE_MIGRATIONS` while Task 3 also passes `[...BASE_MIGRATIONS, eventsMigration]` to `openStateStore`, which will hit `assertNoDuplicates` with `duplicate migration version 2` at runtime. Secondary gaps include missing spec-listed migration idempotency coverage, incomplete query-test coverage for `workflowId`, and concurrency fixture details that should mirror #51's hardened IPC pattern.

## Findings

1. **major — Duplicate migration registration will fail at runtime (Task 2 Step 3 + Task 3 Step 2, `src/state-store/migrations/index.ts` and `src/event-log/store.ts`).** Task 2 instructs appending `eventsMigration` to `BASE_MIGRATIONS`, which matches the spec ("append EVENT_LOG_MIGRATION to BASE_MIGRATIONS"). Task 3 then defines `const ALL_MIGRATIONS = [...BASE_MIGRATIONS, eventsMigration]` and passes it to `openStateStore`. After Task 2 lands, `BASE_MIGRATIONS` already contains version 2, so the spread duplicates it and `runMigrations` throws `StateStoreError('migration-version-conflict', 'duplicate migration version 2')` (see `assertNoDuplicates` in `src/state-store/migrations.ts`). Pick one path and document it:
   - **Spec-aligned (recommended):** register in `BASE_MIGRATIONS` only; `openEventLog` calls `openStateStore({ path: options.path })` with no custom migration list.
   - **Alternative:** keep migration local to event-log and pass `ALL_MIGRATIONS` from `openEventLog` only — but then do **not** modify `BASE_MIGRATIONS` in Task 2 (contradicts spec).

2. **major — Task 2 migration test draft is copy-paste unsafe (Task 2 Step 1, `tests/unit/event-log-migration.test.ts`).** The embedded test uses `log['store'].unsafe`, but `EventLog` has no `store` property — this will not compile as written. The plan notes the fix in prose ("Revise test… use `openStateStore`") but Step 1 still ships the broken snippet. Additionally, `const dbPath = tempDb(); return dbPath.then(async (p) => { … openEventLog({ path: await p })` mixes sync/promise styles incorrectly (`await p` where `p` is already a string). Make Step 1 match the final approach: `async` test, `await tempDb()`, schema introspection via `openStateStore({ path })` + `store.unsafe` or a smoke `append`/`list` assertion.

3. **minor — Spec-listed idempotent re-open test is optional in the plan but required in the spec testing table (Task 2; spec "Testing" section).** The spec maps `event-log-migration.test.ts` to "Migration 2 creates table + indices; **idempotent re-open**." The plan mentions an idempotent alternative in a comment block but does not commit it as a required Step 1 assertion alongside the index probe. Add an explicit `it('is idempotent on second open', …)` that re-opens the same path and appends without error.

4. **minor — TDD red/green inverts for append and query behaviour (Tasks 3–5).** Task 3 implements the full `append`, `list`, and `close` surface before Task 4 and Task 5 write behavioural tests. Task 4 Step 2 says "expect FAIL then PASS after any store fixes," but if Task 3 is complete the append tests will pass on first run — no red phase. Reorder so Task 3 ships only `openEventLog` skeleton (open + close + migration wiring), Task 4 writes append tests (red), then Task 4/5 extend `store.ts` until green; or explicitly label Tasks 4–5 as "characterisation tests after minimal impl" and accept the weaker loop.

5. **minor — Query test plan omits `workflowId` filter despite spec API and implementation (Task 5).** `EventQuery.workflowId` is in the spec public API; Task 3's `list` implements the filter; Task 5's bullet list covers `eventType`, `issueId`, and `agentId` only. Add a seed row with distinct `workflowId` values and assert `list({ workflowId: '…' })` returns only matching rows.

6. **minor — Tasks 4–6 lack concrete test/fixture code blocks (Tasks 4, 5, 6).** Tasks 1–2 include copy-runnable vitest snippets; Tasks 4–5 are bullet lists and Task 6 is behavioural prose only. Compared to #51's plan (full concurrency fixture with IPC callback), this raises executor variance risk. At minimum, Task 6 should include a complete `event-log-concurrent-writer.mjs` skeleton using the **callback form** of `process.send` (lesson from #51 round-1 finding #3) and raw `better-sqlite3` INSERTs into `events` (same pattern as `state-store-concurrent-writer.mjs`), not an ambiguous "opens event log" import that requires a dist build in the forked child.

7. **minor — `list()` after `close()` not in planned test coverage (Task 4 bullet list).** Task 4 covers `append()` after `close()` throwing `closed`; spec error handling applies to both operations. Add one line asserting `list()` after `close()` throws `EventLogError('closed', …)`.

8. **minor — Concurrency test is thinner than the #51 precedent it mirrors (Task 6).** #51's test asserts total count, per-PID counts, unique monotonic ids, and worker exit codes. The plan only specifies total row count === 100 and matching `written` counts. Consider also asserting globally unique `id` values (AUTOINCREMENT under concurrent writers) to catch corruption beyond dropped rows.

9. **nit — Plan references `createWorkflowEngineSink` (Accepted Design Trade-offs) but the spec does not define that symbol.** The spec summary mentions "a small composition helper" for workflow subscribers; non-goals defer wiring. Either name the spec concept ("composition helper at caller root") or drop the invented identifier to avoid grep confusion during #24.

10. **nit — No per-task commit steps.** #51 and other freesolo plans include explicit `git commit` boundaries per task. This plan ends at a full-suite gate without commit guidance. Optional consistency improvement, not a functional blocker.

11. **nit — `OpenEventLogOptions.now` is an undocumented test seam (Task 3, exported via barrel).** The spec's public API shows only `{ path?: string }`. Exporting `now` is reasonable for deterministic ISO timestamp tests; add a one-line note in Accepted Design Trade-offs that it is a test-only injection, not part of the spec contract.

## What looks good

- **Acceptance criteria fully mapped.** Append-only + ISO timestamps, query by agent/issue/type, `schema_version`, and WAL concurrent append each land in a dedicated task; the self-review checklist matches the GitHub issue and spec.
- **Module layout matches the spec verbatim.** `src/event-log/{types,migration,store,index}.ts`, flat `tests/unit/event-log-*.test.ts`, and the concurrency fixture path align with the design doc and repo convention.
- **Scope discipline is correct.** No workflow-engine wiring, no CLI, no pub/sub — consistent with spec non-goals and issue body.
- **Task 1 is exemplary TDD.** Full failing test, expected failure message, complete implementation, and pass verification with all eight canonical event types and `EventLogError` codes pinned.
- **Schema and API match the spec character-for-character.** Table DDL, three indices, camelCase mapping, default limit 100 / clamp 1000, `CURRENT_EVENT_SCHEMA_VERSION = 1`, and typed error codes are all present in the planned code.
- **State-store integration follows #51 patterns.** Uses `store.prepare` method passthrough (not `bind`), wraps SQLite errors in `EventLogError`, and plans a multi-process concurrency test analogous to `state-store-concurrency.test.ts`.
- **Engine isolation preserved.** No changes to `src/workflow/`; wiring deferred to future tickets as specified.

STATUS=pass_with_findings
