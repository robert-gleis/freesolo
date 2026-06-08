# Plan Review Round 2 — Issue #32

## Verdict
pass_with_findings

## Findings

1. **minor — CLI exit `1` harness tests for `store-error` / `closed` not explicitly tasked (plan: Task 7 Step 1; round 1 #9).** Task 5 now covers builder-level `store-error` (missing snapshot) and `closed` (closed store). Task 7 Step 1 documents exit `1` for both codes but only names an explicit `--db` harness case. Add two `ReplayCommandDeps` cases that inject a throwing `buildWorkflowReplay` (or closed stores) and assert `setExitCode(1)`, mirroring how `no-events` → exit `2` is listed.

2. **minor — Migration v4 schema assertion missing from log-store task (plan: Task 2; spec: Testing table).** The spec maps `replay-log-store.test.ts` to "Migration v4, capture/read round-trip, truncated flag." Task 2 adds round-trip and truncated tests but does not assert migration version or `agent_log_snapshots` DDL (indexes included). Follow the `#23` pattern: open a fresh temp DB via `openAgentLogStore`, introspect with `openStateStore` + `store.unsafe` (or equivalent), and confirm version `4` and table columns.

3. **nit — Task 8 isolation sketch property names drift from precedent (plan: Task 8; `planner-engine-isolation.test.ts`).** The sketch uses `f.relativePath` / `f.content`; existing guards use `file.path` / `file.contents` and include a "reads at least one file" sanity check. Align names and add the sanity assertion when copying the template to avoid copy-paste compile errors.

4. **nit — `captureAgentLogSnapshot` omits `AgentLogSnapshot` import source (plan: Task 4 Step 3; spec: Public API).** The helper signature references `AgentLogSnapshot` (defined in `src/agents/log-snapshot.ts` with `stdout`, `stderr`, `combined`, `truncated`). Task 4 should note `import type { AgentLogSnapshot } from '../agents/log-snapshot.js'` and that only `stdout` / `stderr` / `truncated` are persisted (`combined` is dropped per snapshot table schema).

## Notes

### Round 1 remediation summary

| Round 1 # | Severity | Status |
|---|---|---|
| 1 `types.ts` public API never tasked | major | **Resolved** — Task 2 Step 3 implements full `ReplayStep`, `WorkflowReplay`, `ReplayError` / `ReplayErrorCode` before log-store wiring. |
| 2 Builder omits `workflowId` | major | **Resolved** — Task 5 Step 1 assertion + Step 3 implementation bullet (first non-null `workflowId`). |
| 3 `--db` flag wiring unspecified | major | **Resolved** — Task 7 Step 1 `--db` harness test; Step 3 opens/injects both stores, `close()` in `finally`. |
| 4 Engine isolation test deviates from precedent | major | **Resolved** — Task 8 copies `listTsFiles` + `readWorkflowFiles` + regex structure from planner/integration guards (minor sketch drift: finding #3 above). |
| 5 Truncated-flag log-store test missing | minor | **Resolved** — Task 2 Step 4 adds `round-trips truncated flag` case. |
| 6 `ReplayCommandDeps` DI pattern missing | minor | **Resolved** — Task 7 Step 1 defines `ReplayCommandDeps` with `buildWorkflowReplay`, `write`, `setExitCode`. |
| 7 Builder lifecycle `agent.stopped` missing | minor | **Resolved** — Task 5 Step 1 fixture includes `agent.stopped` in ordered-steps scenario. |
| 8 `persistWorkflowEngineEvents` unsubscribe untested | minor | **Resolved** — Task 3 Step 3 adds teardown test (no further `workflow.*` rows after unsubscribe). |
| 9 `store-error` / `closed` test tasks missing | minor | **Mostly resolved** — Task 5 Step 1 tasks both builder codes; Task 7 lists CLI exit `1` mapping but harness cases not named (finding #1 above). |
| 10 `limit: 1000` cap undocumented | nit | **Resolved** — Plan header Trade-off note + Task 5 Step 3 `limit: 1000`. |

All four round 1 **major** findings are fully addressed. Remaining gaps are minor test-coverage polish and sketch alignment, not architectural blockers.

### Spec alignment (spot-check)

| Spec area | Plan coverage | Notes |
|---|---|---|
| Module layout (`src/replay/`, event-log extensions, CLI) | Tasks 1–8 | Matches design architecture diagram |
| Migration v4 `agent_log_snapshots` | Task 2 | DDL in Step 4; explicit migration test deferred (finding #2) |
| Event types + ascending query | Task 1 | Concrete failing/passing tests |
| Persistence helpers (composition root, opt-in) | Tasks 3–4 | Correctly does not wire into `watch` / engine commands per non-goals |
| `buildWorkflowReplay` assembly + hydration | Task 5 | Chronological order, unknown-type skip, error codes, `workflowId`, time bounds |
| Formatters + CLI `replay show` | Tasks 6–7 | `--format`, `--db`, exit codes 0/1/2 |
| Workflow engine isolation | Task 8 | Regex guard on `src/workflow/**/*.ts` |
| Acceptance criteria (offline end-to-end inspection) | Tasks 5–7 | All three criteria mapped |

### What looks good

- Round 1 revisions are concrete and traceable — no hand-wavy "see spec" deferrals for the four majors.
- TDD task structure, per-task commits, `cli.test.ts` registration smoke, and full-suite verification checklist remain clear.
- `limit: 1000` trade-off is documented at plan scope, matching `EventLog.list` clamp in `src/event-log/store.ts`.
- Composition-root persistence deferral aligns with spec non-goals; helpers are shippable without forcing factory wiring in this ticket.
- `createWorkflowEngine` and `AgentLogSnapshot` types exist in the codebase; persistence and capture tasks reference real symbols.

The plan is ready for TDD implementation after optionally addressing findings #1–#2.
