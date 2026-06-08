# Implementation Review — Issue #41, Round 2

## Status
pass_with_findings

## Summary
All Round 1 critical and major findings are verified fixed in code and tests. Production `defaultDeps` wire `openEventLog` and a `ScriptedAgentAdapter` factory; CLI `team stop` marks members `stopped` in the snapshot and emits per-member `agent.stopped`; `tearDown` avoids duplicate stop events on the all-fail create path; CLI negative paths and monitor all-error teardown are now tested. Fifty-one team-related unit tests pass; `npm run build` succeeds. Residual items are minor test gaps and a narrow telemetry edge case in `tearDown` error-skip logic.

---

## Round 1 Fix Verification

| # | Round 1 finding | Status | Evidence |
|---|-----------------|--------|----------|
| 1 | Production CLI `defaultDeps` non-functional stubs | **Fixed** | `src/commands/team.ts:146-196` — `getDefaultEventLog()` via `openEventLog()`, `defaultCreateTeamManager` constructs `TeamLifecycleManager` with `ScriptedAgentAdapter`, `appendEvent` delegates to event log |
| 2 | CLI `team stop` leaves members in `running` state | **Fixed** | `cancelTeamFromSnapshot` maps `members` to `state: 'stopped'` (`team.ts:132-135`) before persisting snapshot |
| 3 | CLI `team stop` omits per-member `agent.stopped` | **Fixed** | `cancelTeamFromSnapshot` emits `buildAgentStoppedEvent` per member (`team.ts:137-139`); asserted in `team-command.test.ts` cancel test |
| 4 | Duplicate `agent.stopped` on all-fail create | **Fixed** | `tearDown` skips `agent.stopped` when `member.status.state === 'error'` (`manager.ts:232-236`); create path emits `start-failed` stop once before `tearDown('error')` |
| 5 | Missing CLI negative-path tests | **Fixed** | `team-command.test.ts` — status exit 2 (`:141-151`), stop exit 2 no snapshot (`:188-198`), start wrong workflow state (`:117-127`) |
| 6 | Missing monitor all-error test | **Fixed** | `team-lifecycle-manager.test.ts:225-243` — adapters return `error`, `monitor()` returns `'error'` |

---

## Acceptance Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Teams created from planner output | **Pass** | `expandTeamDefinition` + `create()`; CLI `team start` reads plan and creates team |
| Teams monitored (status, blocked, timeouts) | **Pass** | `monitor()` poll loop with inactive/blocked/timeout helpers; inactivity and all-error paths tested |
| Teams torn down cleanly | **Pass** | `tearDown()` best-effort stop, idempotent; CLI snapshot cancel; completion/cancel/timeout/error triggers |
| Lifecycle events emitted | **Pass** | Six event builders; four new `EVENT_TYPES`; manager + CLI stop emit full teardown sequence |

---

## Findings

### Critical
None.

### Major
None.

### Suggestions

1. **`tearDown` error-skip is broader than start-failure only (`manager.ts:232-236`).** Round 1 asked to skip duplicate `agent.stopped` for members that already received `start-failed` during `create()`. The implementation skips emission for any member whose post-stop status remains `error`. On the monitor all-error path (now tested), members never receive `agent.stopped` with `reason: 'error'` if adapters report `error` after `stop()`. Teardown still completes correctly; this is a telemetry precision gap. Prefer a `stopEventEmitted` flag on `TeamMemberRuntime` (set in the create catch block) rather than inferring from terminal `error` state.

2. **CLI stop does not assert persisted snapshot member states (`team-command.test.ts`).** The cancel test verifies event types and stdout but mocks `writeTeamRuntimeSnapshot`. A single assertion on the written snapshot's `members[].state === 'stopped'` would lock in fix #2.

3. **`team stop` when snapshot `phase === 'stopped'` is implemented but untested (`team.ts:264-267`).** Spec mandates exit `2` + `no active team`; add a one-line test mirroring the no-snapshot case.

4. **`TeamPlanNotFoundError` on `team start` is untested in `team-command.test.ts`.** `readTeamPlan` rejection propagates through `withCommanderErrorHandling` to exit `1`; `plan-command.test.ts` covers the pattern — parity test would close the spec Error Handling row.

5. **Manager monitor paths still partially untested (carry-over from Round 1).** `isTeamTimedOut` branch and explicit `team.member.blocked` with `reason: 'error'` emission lack dedicated assertions. Code paths exist; low risk given all-error teardown test covers the terminal branch.

6. **`isMemberInactive` returns false when both `lastActivityAt` and `startedAt` are absent (`monitor.ts:14-16`).** Unchanged from Round 1; acceptable if adapters always set `startedAt` on `start()`.

---

## Spec / Plan Alignment

| Area | Alignment |
|------|-----------|
| Module layout (`src/teams/*`, `src/commands/team.ts`) | Matches plan |
| Snapshot-driven CLI `team stop` | Matches plan post round-2 |
| `team start` does not run `monitor()` | Matches spec |
| Engine gate on `team start` only | Matches spec and `plan.ts` |
| `EVENT_TYPES` — 12 canonical types | Matches plan |
| Default lifecycle config (5s poll, 30min blocked) | Matches spec |
| Production CLI usable without test injection | Now aligned (fix #1) |

---

## Event Emissions

### In-process `TeamLifecycleManager`

| Transition | Event | Tested |
|------------|-------|--------|
| Member started | `agent.created` | Yes |
| Start-fail member | `agent.stopped` (`start-failed`) | Yes (partial start) |
| All-start-fail | No duplicate `agent.stopped` on tearDown | Yes (code; count not asserted) |
| Team running | `team.created` | Yes |
| Member inactive | `team.member.blocked` (`inactivity`) | Via timeout test |
| Member runtime error | `team.member.blocked` (`error`) | No explicit assertion |
| Monitor all-error tearDown | `team.tearing-down` / `team.torn-down` | Yes |
| Monitor all-error tearDown | `agent.stopped` per member | Omitted when adapter stays `error` (Suggestion #1) |
| Teardown cancel/complete/timeout | Full sequence | Yes |

### CLI `team stop`

| Event | Emitted | Tested |
|-------|---------|--------|
| `team.tearing-down` | Yes | Yes |
| `agent.stopped` (per member, `cancelled`) | Yes | Yes |
| `team.torn-down` | Yes | Yes |
| Snapshot members `state: 'stopped'` | Yes | Not asserted in test |

---

## CLI Behavior

| Command | Round 1 gap | Round 2 status |
|---------|-------------|----------------|
| `team start` | `defaultDeps` broken | Wired; engine gate + approved guard tested |
| `team status` | Exit 2 untested | Exit 2 tested |
| `team stop` | Members stay `running`; no `agent.stopped`; `appendEvent` stub | Members marked stopped; events emitted; `defaultDeps` wired |

---

## Test Coverage

| File | Tests | Round 2 delta |
|------|-------|---------------|
| `team-command.test.ts` | 8 (+3) | Wrong state, status exit 2, stop exit 2 |
| `team-lifecycle-manager.test.ts` | 9 (+1) | Monitor all-error teardown |
| Other team unit files | 34 | Unchanged; all pass |

**Suite:** `npm test -- tests/unit/team-*.test.ts tests/unit/cli.test.ts tests/unit/event-log-types.test.ts` — 51 tests, all PASS.

**Build:** `npm run build` — PASS.

---

## What Looks Good

- Round 1 critical blocker (production `defaultDeps`) fully resolved; CLI mirrors `plan.ts` singleton event-log pattern.
- `cancelTeamFromSnapshot` is a clean snapshot-only teardown: team events, per-member stops, consistent member states.
- Duplicate stop-event fix on all-fail create is simple and effective for the primary failure mode.
- Negative CLI tests use the same injectable harness as happy paths — no subprocess coupling.
- Domain module unchanged in quality; separation of concerns remains strong.

---

## Verdict Rationale

**pass_with_findings** — Every Round 1 critical and major finding is substantively addressed with code and test evidence. No new critical or major issues were found. Remaining items are minor test gaps and a suggestion to narrow `tearDown` stop-event deduplication so monitor-error teardown retains `agent.stopped` telemetry. Safe to merge; optional follow-ups listed under Suggestions do not block acceptance.

STATUS=pass_with_findings
