# Implementation Review — Issue #41, Round 1

## Status
pass_with_findings

## Summary
The `src/teams/` domain module faithfully implements the spec's `TeamLifecycleManager` lifecycle (create → monitor → tearDown), member expansion, monitor helpers, event builders, and runtime snapshot persistence. All eight team-specific unit test files pass; `npm run build` succeeds. Gaps are concentrated in production CLI wiring (`defaultDeps` stubs), a few untested spec paths (status exit 2, monitor error/teardown edge cases), and intentional snapshot-only `team stop` behavior that omits per-member `agent.stopped` events and does not mark members stopped in the snapshot.

---

## Acceptance Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Teams created from planner output | **Pass** | `expandTeamDefinition` + `TeamLifecycleManager.create()` start adapters from `TeamDefinition`; CLI `team start` calls `readTeamPlan` then `manager.create()` |
| Teams monitored (status, blocked, timeouts) | **Pass** | `monitor()` poll loop with `isMemberInactive`, `isMemberBlockedTooLong`, `isTeamTimedOut`, `isTeamComplete`; inactivity timeout and completion tests pass |
| Teams torn down cleanly | **Pass** | `tearDown()` best-effort `adapter.stop()`, idempotent when `stopped`; triggered on completion, cancel, timeout, all-error |
| Lifecycle events emitted | **Pass** | Six builders in `events.ts`; four new `EVENT_TYPES`; manager emits full in-process sequence; CLI stop emits `team.tearing-down` / `team.torn-down` |

---

## Findings

### Critical

1. **Production CLI `defaultDeps` are non-functional stubs (`src/commands/team.ts`).** `createTeamManager` and `appendEvent` throw `"not configured"` in `defaultDeps`, yet `registerTeamCommands(program)` uses those defaults when called from `src/cli.ts`. Real invocations of `freesolo team start` and `freesolo team stop` will fail with exit code 1 after argument parsing. Only `team status` works out of the box (snapshot read is wired). Tests pass because `team-command.test.ts` injects a full harness. **Fix:** Wire `defaultDeps` with `openEventLog` (or session state-db path) for `appendEvent`, and a `createTeamManager` factory that constructs `TeamLifecycleManager` with a dev/test `ScriptedAgentAdapter` factory — mirroring how `plan.ts` wires `createDefaultPlannerAgent` and `runTeamPlanner`.

### Major

2. **CLI `team stop` leaves member rows in `running` state (`cancelTeamFromSnapshot`).** Snapshot update sets `phase: 'stopped'` and `stopReason: 'cancelled'` but spreads the prior `members` array unchanged. `team status` after stop will show `phase: stopped` with members still `state: 'running'`, which contradicts teardown semantics and will confuse observability consumers. Update member `state` to `'stopped'` (best-effort, snapshot-only) when cancelling.

3. **CLI `team stop` omits per-member `agent.stopped` events (plan-acknowledged deviation).** Snapshot-driven stop correctly avoids cross-process adapter handles, but only appends `team.tearing-down` and `team.torn-down`. Spec `tearDown()` emits `agent.stopped` per member. Documented in plan review round 2 as intentional; still a telemetry gap for operators expecting the full event sequence from the acceptance-criteria table. Consider emitting snapshot-derived `agent.stopped` events with `reason: 'cancelled'` (no adapter call required).

4. **Duplicate `agent.stopped` on all-fail create path (`manager.ts` `create` + `tearDown`).** Members that fail `start()` already receive `agent.stopped` with `reason: 'start-failed'`. When all members fail, `tearDown('error')` emits a second `agent.stopped` per member with `reason: 'error'`. Event log consumers may double-count stops. Skip `agent.stopped` in `tearDown` for members already in `error` from start-failure, or use a distinct event policy.

5. **Missing CLI tests for spec-mandated exit paths (`team-command.test.ts`).** Not covered: `team status` exit `2` + `no active team` when snapshot absent; `team stop` exit `2` when snapshot absent or already `stopped`; `team start` rejection when workflow state ≠ `approved`; `TeamPlanNotFoundError` on missing `team-plan.json`. These are explicit in the spec Error Handling and CLI sections.

6. **Missing manager tests for monitor error and team-timeout paths (`team-lifecycle-manager.test.ts`).** Implemented in `manager.ts` (all-terminal + any-error → `tearDown('error')`; `isTeamTimedOut` branch) but untested. `team.member.blocked` emission for `reason: 'error'` is also untested despite being a spec acceptance-criteria event.

### Suggestions

7. **`isMemberInactive` returns false when both `lastActivityAt` and `memberStartedAt` are absent (`monitor.ts`).** Spec says blocked when `lastActivityAt` is missing **and** `startedAt` is older than timeout. Current helper returns false with no reference timestamp, so a running adapter that omits both fields will never be marked inactive. Low risk if real adapters always set `startedAt`; add a test and consider treating missing reference as inactive after timeout once member is running.

8. **`tearDown` emits `agent.stopped` for `idle` members.** Spec stop loop skips `stopped`/`idle` adapters but still emits stop events for every member. Harmless for happy path (no idle members after successful start) but noisy for partial-failure teardown.

9. **`team start` does not handle `InvalidTransitionError` from `writeState`.** `writeState` can throw when concurrent state drift occurs. `withCommanderErrorHandling` maps this to exit `1` with message — acceptable per spec — but does not print allowed transitions as the spec Error Handling table suggests for `InvalidTransitionError`. Matches `plan.ts` behavior; optional parity with `state.ts`.

10. **`team stop` does not require engine gate.** Consistent with plan review guidance (only state-mutating `start` is gated). No action needed unless product policy changes.

---

## Spec / Plan Alignment

| Area | Alignment |
|------|-----------|
| Module layout (`src/teams/*`, `src/commands/team.ts`) | Matches plan file structure |
| `PlannerHost` aliased as `AgentHost` | Matches plan note |
| `TeamCommandDeps` injectable interface | Matches plan Task 9 |
| Snapshot-driven CLI `team stop` (no live manager) | Matches plan architecture post round-2 |
| `team start` does not run `monitor()` | Matches spec |
| Engine gate on `team start` only | Matches spec and `plan.ts` pattern |
| `EVENT_TYPES` — 12 canonical types | Matches plan Task 4 expectation |
| Default lifecycle config (5s poll, 30min blocked) | Matches spec |
| Member ID slugging and ordering | Matches spec example (`backend-engineer-1`) |

---

## Event Emissions

### In-process `TeamLifecycleManager`

| Transition | Event | Tested |
|------------|-------|--------|
| Member started | `agent.created` | Yes |
| All-start-fail member | `agent.stopped` (`start-failed`) | Partial (presence only) |
| Team running | `team.created` | Yes |
| Member inactive | `team.member.blocked` (`inactivity`) | Via timeout test (implicit) |
| Member error | `team.member.blocked` (`error`) | No |
| Teardown begins | `team.tearing-down` | Yes (cancel) |
| Member stopped | `agent.stopped` | Yes (cancel; duplicate risk on all-fail) |
| Teardown complete | `team.torn-down` | Yes |

`agentId` / `issueId` conventions match spec: member-scoped events set `agentId` to `memberId`; team-level events omit `agentId`.

### CLI `team stop`

| Event | Emitted |
|-------|---------|
| `team.tearing-down` | Yes (tested) |
| `team.torn-down` | Yes (tested) |
| `agent.stopped` | No |

---

## CLI Behavior

| Command | Spec behavior | Implementation | Gap |
|---------|---------------|----------------|-----|
| `team start` | approved guard, read plan, create, `approved→implementing`, summary | Implemented with guards and engine gate | Production `defaultDeps` broken |
| `team status` | JSON snapshot or exit 2 | Reads snapshot, pretty-prints | Exit 2 untested |
| `team stop` | tearDown cancelled, summary | Snapshot cancel + events | No adapter stop; members stay `running` in snapshot; `appendEvent` stub in production |

Exit code mapping in `withCommanderErrorHandling`: `IssueIdError→2`, malformed labels `→4`, default `→1`, engine gate `→3`. Aligns with spec for covered paths.

---

## Test Coverage

| File | Tests | Assessment |
|------|-------|------------|
| `team-members.test.ts` | 4 | Covers slugging, expansion, prompt, defaults |
| `team-monitor.test.ts` | 4 | All four helpers; missing inactive-via-`startedAt`-only case |
| `team-events.test.ts` | 4 | All builders smoke-tested |
| `team-store.test.ts` | 1 | Round-trip with `git init` |
| `team-lifecycle-manager.test.ts` | 8 | Strong create/monitor/tearDown coverage; gaps on error-stop and team timeout |
| `team-command.test.ts` | 5 | Happy paths + engine gate; missing negative CLI cases |
| `event-log-types.test.ts` | 4 | Twelve types asserted |
| `cli.test.ts` | 1 | `team` group registered |

**Suite status:** All team tests pass. One unrelated failure in `local-process-runner.test.ts` (log truncation) — pre-existing, outside #41 scope.

---

## Edge Cases

| Case | Handled | Notes |
|------|---------|-------|
| Partial start failure | Yes | Continues to `running`; `agent.stopped` on failed member |
| All start failure | Yes | `tearDown('error')` without `team.created`; duplicate stop events |
| Concurrent `monitor()` | Yes | `invalid-state` |
| Inactivity timeout | Yes | Blocked → blocked-too-long → `timeout` |
| All members `stopped` | Yes | `completed` |
| All members `error`/`stopped` with ≥1 error | Yes (code) | Untested |
| Team-level timeout | Yes (code) | Untested |
| `tearDown` idempotent | Yes | Returns early when `stopped` |
| CLI stop cross-process | Partial | Snapshot + team events only |
| Missing `team-runtime.json` | Yes (code) | Untested exit 2 |
| Wrong workflow state on start | Yes (code) | Untested |

---

## What Looks Good

- Clean separation: domain in `src/teams/`, CLI in `src/commands/team.ts`, barrel exports — mirrors `planner` and `verification`.
- Monitor helpers are pure functions with injectable `now`/`sleep`; manager tests are deterministic without subprocesses.
- `expandTeamDefinition` and `slugRoleName` match spec examples exactly.
- Event builders centralize payload shapes; easy to assert in tests.
- `TeamLifecycleManager` partial-start and all-fail behavior matches spec paragraphs verbatim.
- Engine gate message and placement consistent with `plan.ts`.
- Runtime snapshot written after create, each monitor tick, and teardown.

---

## Verdict Rationale

**pass_with_findings** — Domain acceptance criteria are met with solid unit-test evidence. The implementation matches the approved plan (including snapshot-driven CLI stop). The critical gap is production CLI default dependency wiring, which blocks end-to-end `team start`/`team stop` usage without test injection; this should be fixed before merge but does not invalidate the core manager design. Remaining findings are test gaps, observability polish, and documented telemetry trade-offs for snapshot-only stop.

**Recommended before merge:** Wire `defaultDeps` (#1), update CLI stop snapshot member states (#2), add CLI negative-path tests (#5).

STATUS=pass_with_findings
