# Plan Review — Issue #41, Round 2

## Status
pass

## Summary
The updated plan resolves all four major and all seven minor/nit findings from round 1. The in-process registry is removed in favour of a snapshot-driven `team stop`; partial-start, all-fail, and concurrent-monitor tests are scheduled; Tasks 4–8 now include runnable test stubs where round 1 had only prose; and `TeamMemberRuntime`, `TeamCommandDeps`, `PlannerHost` aliasing, `buildMemberPrompt`, and `git init` for the store test are all specified. Residual TDD gaps (Task 2 external reference, manager happy-path/completion/cancel stubs, team-events builder bodies) are minor polish on an already-substantially-fixed finding and do not block implementation.

---

## Round 1 Finding Resolution

| # | Severity | Finding | Round 2 status |
|---|----------|---------|----------------|
| 1 | major | In-process registry broken for cross-process `team stop` | **Resolved.** Architecture explicitly states snapshot-driven stop; Task 9 Step 3 tests snapshot update + `team.torn-down` via `appendEvent` with no live manager. Registry references removed. |
| 2 | major | Partial start failure and all-fail cases unplanned | **Resolved.** Task 7 Steps 2–3 add dedicated failing tests with explicit phase, event, and `stopReason` assertions. |
| 3 | major | Monitor concurrency guard unplanned | **Resolved.** Task 8 Step 4 adds concurrent `monitor()` guard test expecting `TeamLifecycleError` code `invalid-state`. |
| 4 | major | Tasks 4–8 revert to prose; TDD discipline breaks | **Substantially resolved.** Task 4 lists all 12 `EVENT_TYPES`; Task 5 store round-trip includes `makeRepo()` + `git init`; Task 6 monitor helpers have full test bodies; Tasks 7–8 edge-case steps are concrete. Residual: Task 7 Step 1 (happy-path create), Task 8 Steps 1–2 (completion, cancel), and Task 4 team-events builder tests remain prose — acceptable for pass. |
| 5 | minor | `TeamMemberRuntime` absent from File Structure | **Resolved.** Listed in File Structure table; Task 1 Step 3 requires it with `adapter: AgentAdapter`. |
| 6 | minor | `AgentHost` vs `PlannerHost` unacknowledged | **Resolved.** Plan header note and `types.ts` alias pattern documented. |
| 7 | minor | `TeamCommandDeps` not specified | **Resolved.** Full interface in Task 9 with 13 injectable fields matching `plan.ts` patterns. |
| 8 | minor | Store test omits `git init` | **Resolved.** Task 5 `makeRepo()` helper runs `git init --quiet`. |
| 9 | minor | `buildMemberPrompt` untested | **Resolved.** Task 3 adds dedicated prompt test asserting role, responsibility, and issue number. |
| 10 | nit | Inactivity test lacks fake-time injection detail | **Resolved.** Task 8 Step 3 shows `now: () => new Date(base + 2 * memberBlockedTimeoutMs)`. |
| 11 | nit | Event-log-types test should list 12 types explicitly | **Resolved.** Task 4 Step 1 provides exact ordered `EVENT_TYPES` expectation. |

---

## New Findings (Round 2)

None blocking. Optional polish for implementer clarity:

1. **Suggestion — Document snapshot-only `team stop` limitation in Task 9.** The snapshot-driven CLI stop path updates `team-runtime.json` and appends events but cannot call `adapter.stop()` cross-process (no live manager, no adapter handles). The spec's `tearDown('cancelled')` applies to in-process `TeamLifecycleManager` usage (runner/tests). Add one sentence to Task 9 Step 5: CLI `team stop` performs logical cancellation (snapshot + events); physical adapter teardown remains the runner's responsibility when it holds the manager. Prevents implementer confusion between manager `tearDown()` and CLI stop.

2. **Nice-to-have — Embed Task 2 expansion tests instead of "see prior plan Task 2".** Task 2 Step 1 references an external prior plan for `slugRoleName` / `expandTeamDefinition` test bodies. An implementing agent without round-1 plan context must reconstruct them. Low risk because `members.ts` patterns are straightforward and Task 1–3 otherwise have inline stubs.

3. **Nice-to-have — Inline stubs for Task 7 Step 1 and Task 8 Steps 1–2.** Happy-path `create()`, monitor completion, and `tearDown('cancelled')` tests are still prose bullets. Edge-case tests (partial start, all-fail, concurrency) now have concrete steps; adding matching stubs for the three happy-path tests would complete the TDD thread from Tasks 1–6.

---

## What Looks Good

- Snapshot-driven stop correctly fixes the cross-process CLI gap without a phantom in-process registry.
- Task renumbering (prompt → events → store → monitor → manager → CLI) follows dependency order and matches spec layering.
- `TeamCommandDeps` includes `appendEvent` and `writeTeamRuntimeSnapshot`, enabling isolated CLI stop tests without SQLite or subprocesses.
- Partial-start and all-fail tests align exactly with spec `create(definition)` paragraphs (continue on single failure; skip `running` when all fail).
- Monitor helper tests use pure functions with injectable `now`, consistent with `TeamLifecycleManagerDeps`.
- File structure, barrel export, and `errors.ts` split remain aligned with `src/planner/` and `src/verification/` conventions.
- Task 10 retains `npm test` + `npm run build` gates.

---

## Verdict Rationale

**pass** — All round 1 major and minor findings have corresponding plan changes. The four major gaps (registry, start-failure edge cases, monitor concurrency, TDD prose regression) are closed. Residual prose in a handful of manager/CLI test steps and the snapshot-vs-`tearDown` documentation note are polish items, not blockers. No new major or minor issues discovered.

STATUS=pass
