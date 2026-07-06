# Plan Review — Issue #45, Round 1

## Status
pass_with_findings

## Summary
The plan is well-scoped, mirrors the spec's policy-module architecture, and maintains TDD discipline across all five tasks with copy-runnable test bodies — a clear improvement over prior multi-task plans. Module layout, type shapes, config resolution order, and the `plan generate` hook point align with the spec and existing `plan.ts` conventions. Gaps are concentrated in the spec's error-handling table (two cases untested), the spec's command-level test expectations (`writeState` call count, `appendEvent` invocation), and event-log wiring that diverges from the established `team.ts` `appendEvent` dep pattern. None of the gaps block implementation start, but Tasks 4–5 should be tightened before merge.

## Findings

1. **major — Spec error-table cases are untested (plan: Task 4 Step 1, Task 5 Step 1; spec: Error Handling table).** The spec defines four failure modes with explicit behaviour. Task 4 only covers `readTeamPlan` failure (state stays `planned`). Missing from any test step:
   - **`InvalidTransitionError`** at auto-approve — stderr, exit `1`, state stays `planned`.
   - **Event log append failure** after successful `writeState(planned → approved)` — stderr, exit `1`, state stays `approved` (transition committed, no rollback).
   Add to `autonomous-approval.test.ts`: (a) `writeState` rejects with `InvalidTransitionError`, assert `appendEvent` not called; (b) `appendEvent` throws `EventLogError`, assert `writeState` was called once with `planned → approved` and error propagates. Add a Task 5 command test where `maybeAutoApproveTeamPlan` is the real function with mocked nested deps and `appendEvent` throws — assert exit `1` and `writeState` still called for the approval transition.

2. **major — Command tests mock away spec-required assertions (plan: Task 5 Step 1; spec: Testing — `plan-command.test.ts`).** The spec explicitly lists command tests for "stdout lines, `writeState` call count, `appendEvent` invoked." Task 5 mocks `maybeAutoApproveTeamPlan` wholesale in all three new tests, so neither `writeState` call count (expect 2 when autonomous: `triaged → planned` then `planned → approved`) nor `appendEvent` invocation is ever asserted at the command layer. Unit coverage in `autonomous-approval.test.ts` partially compensates, but add at least one Task 5 test that calls the real `maybeAutoApproveTeamPlan` with injected `resolveAutonomousMode: () => true`, fake `appendEvent`, and harness `writeState` — then assert `deps.writeState` call count is 2 and `appendEvent` received `team.planned` with `autonomous: true`. Keep the stdout-only tests with a full mock; do not rely on them alone.

3. **minor — Event log wiring diverges from `team.ts` injection pattern (plan: Task 5 Step 3; reference: `src/commands/team.ts:48,182-184`).** `TeamCommandDeps` exposes `appendEvent: (input: AppendEventInput) => void` at the composition root, wired to `getDefaultEventLog().append`. Task 5 instead inlines `openEventLog().append(input)` inside the nested deps passed to `maybeAutoApproveTeamPlan` in the generate action. This works in production but is not injectable from `PlanCommandDeps`, untestable without mocking the entire policy function, and repeats the lesson from #41's round-1 review (non-injectable event log at CLI layer). Prefer adding `appendEvent` to `PlanCommandDeps` (mirroring `team.ts`) and passing `deps.appendEvent` into the policy call; reserve `openEventLog` for `defaultDeps` only.

4. **minor — Duplicate `autonomous_mode` parsers (plan: Task 1 Step 3, Task 3 Step 3; reference: `src/config/load.ts`).** `parseAutonomousMode` is added to `load.ts` for global config, then `parseAutonomousModeFromContent` is copy-pasted into `policy/config.ts` for repo config. Divergence risk on quoting, error messages, or future boolean formats. Extract a shared `parseAutonomousModeLine(content, configPath): boolean | undefined` in `src/config/load.ts` (or `src/config/parse.ts`) and call it from both `loadConfig` and `resolveAutonomousMode`.

5. **minor — Repo config file without `autonomous_mode` key forces `false`, skipping global (plan: Task 3 Step 3; spec: Configuration resolution order).** When `<repo>/.freesolo/config.yaml` exists but omits `autonomous_mode`, `parseAutonomousModeFromContent` returns `false` (not `null`), so `resolveAutonomousMode` never reads global config. Spec step 1 says "parse from repo file if it exists"; step 3 says "default false when absent." Both readings are defensible, but operators with `autonomous_mode: true` globally and an empty/minimal repo config file will get `false`. Add an explicit test and a one-line comment in `resolveAutonomousMode` documenting the chosen semantics, or return `null` when the repo file exists but the key is absent so global applies.

6. **minor — `buildHarness` default deps update is incomplete in the plan snippet (plan: Task 5 Step 1; reference: `tests/unit/plan-command.test.ts:54-77`).** The plan shows `maybeAutoApproveTeamPlan` in comments and override examples but does not show adding it to the required `PlanCommandDeps` object inside `buildHarness`. TypeScript will fail to compile until the field is added. Include the full harness line: `maybeAutoApproveTeamPlan: vi.fn().mockResolvedValue({ status: 'skipped' }),` in the default deps block, not only in override examples.

7. **minor — `maybeAutoApproveTeamPlan` on `PlanCommandDeps` creates double-indirection (plan: Task 5 Step 3).** The policy function is both a top-level dep (mockable wholesale) and receives nested `readTeamPlan` / `writeState` / `appendEvent` overrides at the call site. This is workable but unusual compared to `plan.ts` where `readTeamPlan` and `writeState` are single-level deps. Document in Task 5 Step 3 that nested deps are production wiring only; tests should prefer either full mock (stdout paths) or real policy + injected nested deps (integration path per finding #2), not both simultaneously.

8. **nit — Redundant assertion in Task 4 skip test (plan: Task 4 Step 1).** `expect(result).toEqual({ status: 'skipped' });` followed by `expect(result.status === 'skipped' && true).toBe(true);` adds no value. Remove the second line.

9. **nit — Task 2 Step 5 commit message omitted (plan: Task 2).** Tasks 1, 4, 5 include commit commands; Task 2 Step 5 says "Commit" with no message. Add e.g. `git commit -m "Add team.planned event builder for autonomous approval"`.

10. **nit — `readTeamPlan` error test uses generic `Error` not `TeamPlanValidationError` (plan: Task 4 Step 1; spec: Error Handling).** Spec names `TeamPlanValidationError` explicitly. The generic error still validates propagation, but matching the spec type (`new TeamPlanValidationError('...')`) documents intent and guards against accidental swallowing of typed errors.

## What Looks Good

- All five tasks include complete, copy-runnable failing tests with imports, describe blocks, and assertions — consistent TDD throughout (no prose-only test steps).
- `src/policy/` module layout matches the spec exactly: `types.ts`, `config.ts`, `events.ts`, `autonomous-approval.ts`, `index.ts` — mirrors `src/planner/` / `src/teams/` separation and ADR-0002.
- `buildTeamPlannedEvent` shape matches spec and existing `AppendEventInput` / `team.planned` event type in `src/event-log/types.ts`.
- Config resolution order is correct: repo `.freesolo/config.yaml` first, then global via `loadConfig(defaultConfigPath())` (respects `FREESOLO_CONFIG`).
- `resolveAutonomousMode` accepts injectable `readFile` and `globalConfigPath` — good test isolation without real home directory reads.
- `AutonomousApprovalDeps` uses partial merge with throw-stub defaults for uninjected production deps; unit tests inject all four deps per spec.
- Hook point is correct: after `writeState(triaged → planned)` and `team plan written` stdout, inside existing `withCommanderErrorHandling` try block.
- Engine gate correctly inherited from generate command; no separate autonomous gate (per spec).
- `AutonomousApprovalResult` discriminated union (`skipped` | `approved`) is clean and matches spec return shapes.
- Self-review and acceptance-criteria mapping tables cover all four issue criteria and eight spec requirements.
- No placeholders, TODOs, or TBD markers in the plan.
- Task 5 closes with full test suite + `npm run build` gate.
- Non-goals respected: no ADR writes, no `plan.approve` changes, no engine tick policy, no per-issue workflow overrides.

STATUS=pass_with_findings
