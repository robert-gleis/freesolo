# Implementation Review Round 1 — Issue #32

## Verdict
pass_with_findings

## Findings

1. **minor — Issues with only non-replayable events succeed with an empty timeline (`src/replay/builder.ts:93-116`).** `no-events` is thrown only when `eventLog.list` returns zero rows. If an issue has events but every row maps to `null` (e.g. only `plan.approved`, `verification.passed`), the builder returns `{ steps: [], startedAt: null, endedAt: null }` and the CLI exits `0`. Operators may interpret that as a successful replay with no activity rather than “nothing to replay.” Consider treating `steps.length === 0` after a non-empty event list as `no-events` (or a dedicated code) in a follow-up.

2. **minor — Invalid `--format` uses exit code `2` (`src/commands/replay.ts:47-50`).** The spec documents exit `2` only for missing telemetry (`ReplayError` code `no-events`). Unsupported format values also set exit `2`, which conflates validation failure with “no replay data.” This matches other FreeSolo commands (e.g. `candidate`, `plan`) that use `2` for validation, but diverges from the spec’s narrow exit-code table. Document or align in a follow-up.

3. **minor — Unknown event-type skip is only implicitly tested (`tests/unit/replay-builder.test.ts:121-131`).** The assembly test appends `plan.approved` and asserts five mapped steps, so skip behaviour is covered indirectly. There is no explicit assertion that `plan.approved` (or another unknown type) is absent from `steps` or that step count excludes it. A one-line `expect(replay.steps).toHaveLength(5)` would make forward-compatibility intent obvious.

4. **minor — `captureAgentLogSnapshot` is not atomic (`src/replay/persistence.ts:38-57`).** The helper inserts into `agent_log_snapshots` before appending `agent.log.captured`. If `eventLog.append` fails, an orphan snapshot row remains with no referencing event. Low probability in v1 (same-process SQLite), but worth a transaction or append-first ordering note for future hardening.

5. **nit — `startedAt` / `endedAt` bound mapped steps, not raw events (`src/replay/builder.ts:114-115`).** Leading or trailing skipped event types are excluded from the time window. This matches the plan (“from first/last step timestamps”) and is reasonable; callers should not assume bounds cover every persisted row.

6. **nit — `1000`-event replay cap is implemented but untested (`src/replay/builder.ts:84`).** The plan documents `limit: 1000` as an accepted v1 trade-off. No test asserts truncation behaviour; acceptable for ship, but a regression test would lock the ceiling if the limit changes.

## Notes

### Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Completed workflow execution inspectable end-to-end | **Met** | `buildWorkflowReplay` assembles ordered `ReplayStep[]` across `workflow.decision`, `workflow.transition`, `agent.lifecycle`, and `agent.log` (`replay-builder.test.ts`). Text/JSON formatters and `freesolo replay show` expose the timeline. |
| Agent decisions and outputs viewable | **Met** | `workflow.decision` steps carry `fromState` and `action`; `agent.log` steps hydrate stdout/stderr from `agent_log_snapshots` (`replay-persistence.test.ts`, `replay-format.test.ts`). |
| Replay works without a live session | **Met** | Builder and CLI read only SQLite via `EventLog` + `AgentLogStore`; no agent process or session dependency. `--db` override tested in `replay-command.test.ts`. |

### Plan and spec alignment

| Area | Status |
|---|---|
| `src/replay/` module layout (types, migration, log-store, persistence, builder, format, barrel) | Complete |
| Migration v4 `agent_log_snapshots` + indexes on `BASE_MIGRATIONS` | Complete (`migration.ts`, `replay-log-store.test.ts`, `state-store-api.test.ts` versions `[1,2,3,4]`) |
| Event types `workflow.decision`, `workflow.transition`, `agent.log.captured` | Complete (`event-log/types.ts`) |
| `EventQuery.order` ascending support | Complete (`event-log/store.ts`, `event-log-query.test.ts`) |
| `persistWorkflowEngineEvents` + unsubscribe | Complete (`replay-persistence.test.ts`) |
| `captureAgentLogSnapshot` (stdout/stderr/truncated only) | Complete |
| `buildWorkflowReplay` hydration, `workflowId`, error codes | Complete |
| `formatReplayText` / `formatReplayJson` | Complete |
| `freesolo replay show --issue [--format] [--db]` + exit codes 0/1/2 | Complete (`replay-command.test.ts`, `cli.test.ts` registration smoke) |
| Workflow engine isolation (`src/workflow/**` → no replay imports) | Complete (`replay-engine-isolation.test.ts`) |
| Composition-root wiring of persistence helpers into watch/engine | **Deferred** (spec non-goal: callers opt in at composition time) |

### Verification

- `npm test -- tests/unit/replay-*.test.ts tests/unit/event-log-*.test.ts tests/unit/cli.test.ts tests/unit/state-store-api.test.ts` — **pass** (13 files, 53 tests)
- `npm run build` — **pass**

### Summary

Implementation delivers the planned offline replay read path: migration v4, extended event types, builder assembly with log hydration, formatters, CLI, and workflow isolation guard. All three acceptance criteria are satisfied. Findings are behavioural edge cases and test/documentation gaps — none block v1 ship. Highest-value follow-up: clarify empty-step vs `no-events` semantics (finding 1).

**Findings count: 6** (4 minor, 2 nit)
