# Plan Review Round 1 — Issue #32

## Verdict
pass_with_findings

## Findings

1. **major — Spec public types in `src/replay/types.ts` are never tasked (plan: Task 2, Task 5; spec: Public API).** File Structure assigns `ReplayStep`, `WorkflowReplay`, and `ReplayError` to `types.ts`, but Task 2 Step 3 only sketches log-store interfaces and Task 5 jumps straight to `buildWorkflowReplay`. The spec defines the full `ReplayStep` union, `WorkflowReplay` aggregate, and `ReplayError` codes (`no-events`, `store-error`, `closed`). Add an explicit implementation step (Task 5 Step 3a or extend Task 2 Step 3) with the spec type definitions before the builder logic.

2. **major — Builder omits `workflowId` on `WorkflowReplay` (plan: Task 5 Step 3; spec: Public API).** Task 5 only tasks `startedAt`/`endedAt` from first/last step timestamps. The spec requires `workflowId: string | null` on the replay object (e.g. first non-null `workflowId` among listed events, or `null` when absent). Add a builder test assertion and implementation bullet.

3. **major — `--db` flag wiring is unspecified (plan: Task 7 Step 3; spec: CLI).** The spec documents `freesolo replay show --issue <n> [--db <path>]`, and `buildWorkflowReplay` accepts injectable `eventLog` / `logStore` but no `path`. Task 7 lists `--db` in the command signature but Step 3 only says `showAction` calls `buildWorkflowReplay` without opening both stores at the overridden path and injecting them. Add Step 3 wiring (`openEventLog({ path: db })`, `openAgentLogStore({ path: db })`, `close()` in `finally`) and a CLI test that seeds a temp DB and reads via `--db`.

4. **major — Engine isolation test deviates from established repo pattern (plan: Task 8; precedent: `planner-engine-isolation.test.ts`, `integration-engine-isolation.test.ts`).** Task 8 supplies only a `REPLAY_IMPORT_REGEX` constant. Every existing isolation guard recursively reads all `src/workflow/**/*.ts` via `listTsFiles` + `readWorkflowFiles` and matches module-path imports. Replace Task 8 Step 1 with the same structure as `planner-engine-isolation.test.ts`, substituting `replay` for `planner`.

5. **minor — Truncated-flag test missing from log-store task (plan: Task 2; spec: Testing table).** The spec maps `replay-log-store.test.ts` to "Migration v4, capture/read round-trip, **truncated flag**." Task 2's sample test only asserts stdout/stderr. Add a case with `truncated: true` on capture and assert it round-trips on `read()`.

6. **minor — `ReplayCommandDeps` DI pattern not specified (plan: Task 7; precedent: `candidate-command.test.ts`, `plan-command.test.ts`).** Task 7 lists exit-code expectations but does not task a `ReplayCommandDeps` interface with injectable `write`, `setExitCode`, and `buildWorkflowReplay` (or store openers). Without this, command tests may couple to `process.stdout` / `process.exitCode`. Mirror the harness pattern from `candidate-command.test.ts`.

7. **minor — Builder lifecycle coverage incomplete (plan: Task 5 Step 1; spec: `ReplayStep` union).** Scenario bullets mention `agent.created` and `agent.log.captured` but not `agent.stopped` → `{ kind: 'agent.lifecycle', eventType: 'agent.stopped', … }`. The spec calls created/stopped "lifecycle bookends." Add `agent.stopped` to the ordered-steps fixture and assertion.

8. **minor — `persistWorkflowEngineEvents` unsubscribe behavior untested (plan: Task 3; spec: Public API).** The spec states the helper "returns unsubscribe function for tests." Task 3 tasks the subscriber and event assertions but not teardown: call returned unsubscribe, emit another engine event, assert no further `workflow.*` rows appended.

9. **minor — `ReplayError` `store-error` / `closed` codes lack explicit test tasks (plan: Tasks 5, 7; spec: Error handling).** Task 5 covers `no-events`; Task 7 mentions exit `1` via "inject throwing builder" but does not task builder-level `store-error` (SQLite / hydration failure) or `closed` (operations on closed log store). Add builder tests for both codes and map them to CLI exit `1` in Task 7.

10. **nit — Builder query uses `limit: 1000` without documenting the cap (plan: Task 5 Step 3; spec: builder lists events for `issueId`).** `EventLog.list` clamps to 1000 max; replays for issues with more than 1000 events would be truncated. Acceptable for v1, but add a one-line trade-off note in Task 5 or the plan header so implementers know the ceiling.

## Notes

All three acceptance criteria are mapped to tasks: end-to-end assembly (Task 5), decisions + log output (Tasks 3–6), offline inspection (Tasks 5–7). Module layout, migration v4 on `BASE_MIGRATIONS`, event-type extensions, ascending query order, TDD task structure with per-task commits, `cli.test.ts` registration smoke, and full-suite verification checklist align with the spec and mirror #35 / #23 conventions. Composition-root wiring of persistence helpers into `watch` / engine commands is correctly deferred per spec non-goals ("callers opt in at composition time"). After addressing findings 1–4 (and preferably 5–9), the plan is ready for TDD implementation.
