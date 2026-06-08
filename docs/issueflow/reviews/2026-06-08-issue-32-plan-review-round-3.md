# Plan Review Round 3 — Issue #32

## Verdict
pass

## Findings
(none)

## Notes

### Round 2 remediation summary

| Round 2 # | Severity | Status |
|---|---|---|
| 1 CLI exit `1` harness for `store-error` / `closed` | minor | **Resolved** — Task 7 Step 1 explicitly tasks inject-mock cases for both `ReplayError` codes with `setExitCode(1)`. |
| 2 Migration v4 schema assertion missing | minor | **Resolved** — Task 2 Step 4 adds `applies migration version 4 with agent_log_snapshots table` introspection test (version + `truncated` column via `PRAGMA table_info`). |
| 3 Task 8 isolation sketch property-name drift | nit | **Resolved** — Task 8 uses `file.path` / `file.contents` and includes `reads at least one workflow source file` sanity check, matching `planner-engine-isolation.test.ts`. |
| 4 `captureAgentLogSnapshot` import source omitted | nit | **Resolved** — Task 4 Step 3 documents `import` from `../agents/log-snapshot.js` and persisting only `stdout` / `stderr` / `truncated`. |

All round 1 and round 2 findings are fully addressed. No new architectural, coverage, or spec-alignment gaps remain.

### Round 1 carry-over (via round 2)

All ten round 1 findings were remediated in rounds 1–2 revisions; round 3 confirms no regressions. Highlights retained in the plan: `types.ts` public API (Task 2 Step 3), `workflowId` on `WorkflowReplay` (Task 5), `--db` dual-store wiring (Task 7), `ReplayCommandDeps` DI (Task 7), builder error codes (Task 5), unsubscribe test (Task 3), `limit: 1000` trade-off (plan header).

### Spec alignment (final spot-check)

| Spec area | Plan coverage | Notes |
|---|---|---|
| Module layout (`src/replay/`, event-log extensions, CLI) | Tasks 1–8 | Matches design architecture diagram |
| Migration v4 `agent_log_snapshots` + indexes | Task 2 | DDL in Step 4; migration assertion test tasked |
| Event types + ascending query | Task 1 | Concrete failing/passing tests |
| Persistence helpers (composition root, opt-in) | Tasks 3–4 | Does not wire into `watch` / engine commands per non-goals |
| `buildWorkflowReplay` assembly + hydration | Task 5 | Chronological order, unknown-type skip, `workflowId`, time bounds, all three `ReplayError` codes |
| Formatters + CLI `replay show` | Tasks 6–7 | `--format`, `--db`, exit codes 0/1/2 with harness cases |
| Workflow engine isolation | Task 8 | Regex guard on `src/workflow/**/*.ts` |
| Acceptance criteria (offline end-to-end inspection) | Tasks 5–7 | All three criteria mapped |

### Codebase precedent verification

Spot-checked against the current branch:

- `createWorkflowEngine` and `WorkflowEngineEvent` (`decision` / `transition`) exist in `src/workflow/engine.ts`; Task 3 persistence mapping is feasible.
- `AgentLogSnapshot` (`stdout`, `stderr`, `combined`, `truncated`) exists in `src/agents/log-snapshot.ts`; Task 4 import path is correct.
- `CandidateCommandDeps` harness pattern exists in `tests/unit/candidate-command.test.ts`; `ReplayCommandDeps` mirrors it.
- `planner-engine-isolation.test.ts` structure matches Task 8 sketch (`listTsFiles`, `readWorkflowFiles`, `file.path` / `file.contents`).
- `BASE_MIGRATIONS` currently ends at version 3 (`worktreesMigration`); appending replay migration v4 is the correct next version.
- `EventLog.list` clamps to `limit: 1000` in `src/event-log/store.ts`; plan trade-off note is accurate.

### Implementation hint (non-blocking)

Task 2 migration assertion sketch uses `store.getAppliedVersion()`, which is not on `StateStore`. Follow `tests/unit/state-store-api.test.ts` and query `schema_migrations` via `store.prepare(...)` (expect versions `[1, 2, 3, 4]` after replay migration ships). TDD Step 1 will surface this immediately; no plan revision required.

### Readiness

The plan is implementation-ready for TDD execution via `superpowers:subagent-driven-development` or `superpowers:executing-plans`. Task ordering, file paths, test scenarios, exit-code mapping, verification checklist (`npm test`, `npm run build`), and per-task commit cadence are complete and traceable to the spec.
