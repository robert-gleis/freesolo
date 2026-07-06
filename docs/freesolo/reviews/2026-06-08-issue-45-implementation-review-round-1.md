# Implementation Review — Issue #45, Round 1

## Status
pass_with_findings

## Summary
The policy module (`src/policy/`) and `plan generate` hook implement the approved spec: `autonomous_mode` config (global + per-repo override), optional `planned → approved` auto-transition after planner output, and `team.planned` event emission with `teamPlanPath` and `autonomous: true`. Production CLI wiring in `plan.ts` is complete — `maybeAutoApproveTeamPlan`, `appendEvent` via `openEventLog()`, and nested dep injection match the plan. All 37 targeted unit tests pass; `npm run build` succeeds. Remaining gaps are minor test-coverage omissions (skipped-path side effects, CLI config-parse failure) and do not block merge.

---

## Acceptance Criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| `autonomous_mode: true` auto-transitions `planned → approved` after planner output | **Pass** | `maybeAutoApproveTeamPlan` in `autonomous-approval.ts`; called from `plan generate` after `writeState(..., 'triaged', 'planned')`; integration test asserts two `writeState` calls |
| `autonomous_mode: false` requires human `plan approve` | **Pass** | Policy returns `{ status: 'skipped' }` when `resolveAutonomousMode` is false; `plan approve` unchanged; stdout test confirms no autonomous line |
| Auto-approval recorded as `team.planned` with team definition path | **Pass** | `buildTeamPlannedEvent` payload includes `teamPlanPath` and `autonomous: true`; policy and command integration tests assert shape |
| Decisions not recorded as ADRs | **Pass** | No ADR writer touched; Event Log only via `appendEvent` |

---

## Plan Task Completion

| Task | Status | Notes |
|------|--------|-------|
| Task 1: Extend global config with `autonomous_mode` | **Complete** | `FreesoloConfig`, `DEFAULT_CONFIG`, `parseAutonomousModeFromContent`, `loadConfig`; 3 new config-load tests |
| Task 2: Policy event builder | **Complete** | `events.ts`, barrel export, `policy-events.test.ts` |
| Task 3: `resolveAutonomousMode` (repo override) | **Complete** | `config.ts` with repo-then-global resolution; 5 policy-config tests including fallback when repo omits key |
| Task 4: `maybeAutoApproveTeamPlan` | **Complete** | `types.ts`, `autonomous-approval.ts`; 5 tests covering skip, approve, validation/transition/log failures |
| Task 5: Wire `plan generate` | **Complete** | `PlanCommandDeps` extended; 4 autonomous generate tests including real-policy integration |

---

## Findings

### Critical
None.

### Major
None.

### Minor

1. **Skipped-path side effects not asserted (`autonomous-approval.test.ts`).** Spec says when autonomous mode is off, policy returns `{ status: 'skipped' }` immediately with "no event, no state change." Implementation correctly short-circuits before `readTeamPlan` / `writeState` / `appendEvent`, but the skip test only checks the return value. Add `expect(readTeamPlan).not.toHaveBeenCalled()` (and same for `writeState`, `appendEvent`) to lock the contract.

2. **No CLI test for config parse failure during `plan generate` (`plan-command.test.ts`).** Spec error table: invalid `autonomous_mode` → throw at `resolveAutonomousMode` → generate exits `1`. `policy-config.test.ts` and `config-load.test.ts` cover parsing in isolation; no command test wires real `resolveAutonomousMode` with an invalid repo/global config and asserts exit `1` + stderr. Low risk given unit coverage; acceptable v1 omission per plan review round 2.

3. **No command-layer `EventLogError` integration test (`plan-command.test.ts`).** Policy unit test confirms `writeState` succeeds then `EventLogError` propagates (state stays `approved`). Generic `exits 1 when auto-approve policy throws` covers CLI error surfacing. Matches plan review round 2 acceptable omission.

### Suggestions

4. **`maybeAutoApproveTeamPlan` call args not asserted in stdout-only test.** `prints autonomous approval line when policy approves` checks `toHaveBeenCalled()` but not `repoRoot`, `teamPlanPath`, or nested deps. Optional tightening.

5. **`openEventLog()` vs lazy singleton.** `plan.ts` uses `openEventLog().append` directly; `team.ts` uses `getDefaultEventLog()`. Functionally equivalent; optional consistency.

6. **Document `autonomous_mode` in operator docs.** Spec risk note flags config drift when only global is set. No README/CLI help change in scope; consider follow-up `freesolo config show`.

---

## Spec / Plan Alignment

| Area | Alignment |
|------|-----------|
| Module layout (`src/policy/*`, config extensions, `plan.ts` hook) | Matches plan file structure |
| Option B: policy module + composition-root hook | Matches spec recommendation |
| Config resolution: repo wins, global fallback, default `false` | Matches spec; repo-without-key falls through to global (round 1 plan fix applied) |
| Shared `parseAutonomousModeFromContent` | Matches plan; used by `loadConfig` and `policy/config.ts` |
| Trigger only from `plan generate` after `triaged → planned` | Matches spec; `plan edit` does not auto-approve |
| Event type `team.planned` (not `plan.approved`) | Matches spec non-goals |
| Human `plan approve` unchanged, no event on manual approve | Matches spec non-goals |
| Error handling: no rollback of `triaged → planned` on auto-approve failure | Correct — policy runs after first transition; failures leave `planned` |
| Event log failure after committed `approved` transition | Tested in policy unit test; v1 trade-off per spec |
| Engine gate inherited from generate | `requireEngineGate` unchanged; autonomous path inside gated action |
| `defaultDeps` stubs for uninjected policy deps | `readTeamPlan` / `writeState` / `appendEvent` throw if called without injection; `plan.ts` always injects on generate path |

---

## Implementation Walkthrough

### Config (`src/config/types.ts`, `src/config/load.ts`)

- `FreesoloConfig.autonomous_mode: boolean` with `DEFAULT_CONFIG.autonomous_mode: false`.
- `parseAutonomousModeFromContent` exported; accepts `true`/`false` only; path-qualified error on invalid values.
- `loadConfig` merges parsed value or default; missing file returns full `DEFAULT_CONFIG`.

### Policy (`src/policy/`)

- **`events.ts`:** `buildTeamPlannedEvent(issueNumber, teamPlanPath)` → `{ eventType: 'team.planned', issueId, payload: { teamPlanPath, autonomous: true } }`.
- **`config.ts`:** `resolveAutonomousMode(repoRoot)` reads `<repo>/.freesolo/config.yaml` first; `undefined` key falls through to `loadConfig(global)`.
- **`autonomous-approval.ts`:** Gate → `readTeamPlan` (re-validate) → `writeState(planned, approved)` → `appendEvent`. Early return `{ status: 'skipped' }` when disabled.
- **`index.ts`:** Barrel exports functions and types.

### CLI (`src/commands/plan.ts`)

After successful generate and `triaged → planned`:

```ts
const approval = await deps.maybeAutoApproveTeamPlan(input, {
  readTeamPlan: deps.readTeamPlan,
  writeState: deps.writeState,
  appendEvent: deps.appendEvent
});
if (approval.status === 'approved') {
  deps.write('stdout', 'planned -> approved (autonomous)\n');
}
```

- `defaultDeps.maybeAutoApproveTeamPlan` = real implementation.
- `defaultDeps.appendEvent` → `openEventLog().append(input)`.
- Errors caught by `withCommanderErrorHandling` → stderr + exit `1`; `triaged → planned` not rolled back.

---

## Error Handling

| Error | Spec behaviour | Implementation | Tested |
|-------|----------------|----------------|--------|
| Invalid `autonomous_mode` | Throw at resolve; generate exit `1` | `parseAutonomousModeFromContent` throws; propagates through policy | Unit only (repo + global loadConfig) |
| `TeamPlanValidationError` | Exit `1`, state stays `planned` | Re-thrown before `writeState` | Yes (`autonomous-approval.test.ts`) |
| `InvalidTransitionError` | Exit `1`, state stays `planned` | Re-thrown before `appendEvent` | Yes |
| `EventLogError` after transition | Exit `1`, state stays `approved` | `appendEvent` throws after `writeState` | Yes (policy unit) |
| Generic policy error | Exit `1` | `withCommanderErrorHandling` | Yes (`plan-command.test.ts`) |

---

## CLI Behaviour

| Scenario | Expected stdout | Implementation | Tested |
|----------|-----------------|----------------|--------|
| Autonomous off | `team plan written: <path>` only | Skip path, no second line | Yes |
| Autonomous on | + `planned -> approved (autonomous)` | Printed when `approval.status === 'approved'` | Yes |
| `plan approve` | Unchanged (`planned -> approved`) | No policy hook on approve | Existing approve tests unchanged |
| `plan edit` | No auto-approve | No `maybeAutoApproveTeamPlan` call | N/A (spec non-goal) |

---

## Test Coverage

| File | Tests | Assessment |
|------|-------|------------|
| `config-load.test.ts` | 6 (+3 new) | Default, parse true, invalid value |
| `policy-events.test.ts` | 1 | Event shape |
| `policy-config.test.ts` | 5 | Missing files, global, repo override, fallback, invalid repo |
| `autonomous-approval.test.ts` | 5 | Skip, approve, validation/transition/log errors |
| `plan-command.test.ts` | 20 (4 autonomous) | Stdout, exit codes, real-policy integration with `writeState`×2 + `appendEvent` |

**Suite status:** 37/37 PASS (`npx vitest run` on listed files).

**Build status:** `npm run build` PASS.

---

## Edge Cases

| Case | Handled | Notes |
|------|---------|-------|
| Autonomous off after successful generate | Yes | Skipped; issue at `planned` |
| Autonomous on, valid plan | Yes | `planned → approved` + event |
| Plan unreadable at auto-approve | Yes | Stays `planned` |
| State drift at auto-approve | Yes | `InvalidTransitionError`; no event |
| Event log DB failure | Yes | Stays `approved` (v1 trade-off) |
| Invalid config with autonomous intended off | Yes (spec) | Still throws on parse — spec-mandated |
| Repo config exists, key absent | Yes | Falls through to global |
| Generate already at `approved` | N/A | Generate requires `triaged` guard |
| `plan approve` when already auto-approved | Yes (existing) | State guard rejects non-`planned` |

---

## What Looks Good

- Clean module boundary: policy logic isolated in `src/policy/`, testable without Commander.
- `parseAutonomousModeFromContent` shared between global and repo paths — no parser drift.
- `PlanCommandDeps` injection pattern mirrors `team.ts`; production defaults are functional (contrast with #41 initial stubs).
- Policy error tests map row-for-row to spec error table.
- Command integration test uses real `maybeAutoApproveTeamPlan` with nested mocks — avoids over-mocking while keeping stdout tests simple.
- Barrel `index.ts` exports types for future engine runner reuse.
- Minimal diff scope: no planner, team lifecycle, or ADR changes.

---

## Verdict Rationale

**pass_with_findings** — All four issue acceptance criteria are met with passing unit tests and a clean build. Implementation matches the approved plan and spec architecture (option B). Production `plan generate` wiring is complete. Findings are limited to minor test assertions and deferred CLI edge-case tests already acknowledged as acceptable v1 omissions in plan review round 2. No bugs or spec deviations warrant blocking merge.

**Optional before round 2:** Add skipped-path no-side-effect assertions (#1).

STATUS=pass_with_findings
