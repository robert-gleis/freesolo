# Plan Review Round 1 — Issue #42

## Verdict
pass_with_findings

## Findings

1. **major — Task 6 does not wire `action.agent.agentId` into `prepareAgentSpawn` (spec: Integration → Workflow engine step 2; plan: Task 6 Step 4).** The spec shows `prepareAgentSpawn({ agentId, role, workingDirectory, baseInstructions: … })` with `agentId` taken from the policy request when present. `AgentTaskRequest` gains optional `agentId` in Task 6 Step 1, and `prepareAgentSpawn` already accepts `agentId?: string` (Task 5), but the engine wiring step only resolves `role` and never forwards `action.agent.agentId`. Policies that supply a stable id (e.g. from `expandTeamPlan`) would be ignored and regenerated. Add an explicit line: pass `agentId: action.agent.agentId` into `prepareAgentSpawn`, and a test with a custom `agentId` on the spawn action.

2. **major — Task 7 omits optional `agent.created` emission for `freesolo start` (spec: Integration → `freesolo start`; plan: Task 7 Step 3).** The spec requires: "Log the spawn line and **optionally append `agent.created` when event log is configured**." Task 7 only adds `console.error(spawn.logLine)` and never injects or calls `appendEvent`, unlike Task 6 for the engine. Even if production wiring is thin in v1, the plan should task either (a) an injectable `appendEvent` on `StartPlanDeps` with a test when configured, or (b) an explicit deferral note tied to #41 so implementers do not assume the spec requirement was dropped.

3. **major — Task 6 Step 5 understates spawn-test breakage; multiple existing tests need expectation updates (plan: Task 6 Step 5; `tests/unit/workflow-engine.test.ts`).** Step 5 only says to update the `starts the agent` test. After role framing, at least two more spawn tests will fail as written:
   - `enriches spawn instructions with knowledge entries before start and send` asserts `enriched` contains `continue freesolo` and `## Factory Knowledge Base` but not the role section; ordering should be role → knowledge per spec.
   - `translates InvalidTransitionError from the spawn writeState` expects `agent.sendCalls).toEqual(['go'])` but send will receive role-framed instructions.
   List all affected spawn tests and show updated assertions (role section present, knowledge still appended after role block).

4. **minor — `agent.stopped` payload convention has no plan coverage (spec: Event log payload).** The spec documents that `agent.stopped` payloads include `{ "roleName": "…" }` for correlation. Nothing in `src/` emits `agent.stopped` today, so full wiring may land with #41, but the plan neither exports a small helper (e.g. `buildAgentStoppedPayload(role)`) nor documents intentional deferral. Add a one-line export/helper in `spawn.ts` or a note in Task 5/6 so the convention is not lost.

5. **minor — Engine default role host is hardcoded to `'cursor'` (spec: Risks → host vs `chosenHost`; plan: Task 6 Step 4).** `buildDefaultImplementerRole('cursor')` is used when policy omits `role`, but the engine has no access to session `chosenHost`. Acceptable for v1, but the plan should document why `'cursor'` is the fallback (or add an optional `defaultSpawnHost?: PlannerHost` on `WorkflowEngineDeps`) to avoid silent mismatch when policies omit role on non-Cursor sessions.

6. **minor — No engine test for explicit policy-supplied `role` / `agentId` (spec: `AgentTaskRequest` optional fields; plan: Task 6 Step 2).** The new test only covers the default-Implementer path. Add a case where `action.agent` includes a custom `AgentRoleAssignment` and `agentId`, asserting the framed prompt, log line, and `appendEvent` payload reflect the explicit role.

7. **minor — `team-expand.test.ts` does not cover the spec's isolated "single role" scenario (spec: Testing → `team-expand.test.ts`; plan: Task 4).** The single test covers multi-count plus multiple roles in one case. A dedicated `count: 1` test would catch off-by-one bugs in `instanceIndex` / `instanceCount` and matches the spec's enumerated scenarios.

8. **minor — Task 3 defers all log-format tests to Task 5 without asserting log field order (plan: Task 3 Step 1; spec: Logging).** Indirect coverage via `team-spawn.test.ts` is adequate for happy path, but the spec's exact field order (`agent=… role="…" host=… instance=… cwd=…`) is only partially asserted (`agent=` and `role=`). Extend Task 5 assertions to match the full spec line shape including `host=`, `instance=`, and `cwd=`.

9. **nit — Engine test snippet omits `AppendEventInput` import (plan: Task 6 Step 2).** The proposed test uses `AppendEventInput[]` but does not import from `../../src/event-log/types.js`. Trivial fix; add the import line to avoid implementer guesswork.

10. **nit — Plan adds `src/team/agent-id.ts` beyond the spec's five-file sketch (spec: Architecture; plan: File Structure).** Sensible extraction; not a behavioural deviation. Note in Task 1 that `agent-id` logic implements the spec's `agentId` format rule.

## Spec coverage checklist

| Spec requirement | Plan task(s) | Status |
|---|---|---|
| `AgentRoleAssignment`, `TeamAgentSpawnSpec`, `RoleContextProfile` types | Task 1 | Covered |
| `agentId` format (`agent-{issue}-{slugified-role}-{index}`) | Task 1 (`agent-id.ts`) | Covered |
| `expandTeamPlan(definition, input)` — per-role `count`, shared cwd/instructions | Task 4 | Covered (single-role-only test gap — finding #7) |
| `buildRolePrompt` — `## Your Role`, instance suffix rules, before base instructions | Task 2 | Covered |
| Prompt composition order: base → role frame → knowledge | Tasks 2, 5, 6, 7 | Covered |
| `formatAgentSpawnLog` stderr line shape | Task 3 (impl), Task 5 (assert) | Partial (full field assertions — finding #8) |
| `prepareAgentSpawn()` → `{ agentId, role, instructions, logLine, eventPayload }` | Task 5 | Covered |
| `agent.created` payload fields (`roleName`, `responsibility`, `host`, instance, `workingDirectory`) | Task 5, Task 6 | Covered for engine; start path missing append (finding #2) |
| `agent.stopped` payload `{ roleName }` convention | — | Missing (finding #4) |
| `AgentTaskRequest` optional `agentId`, `role` | Task 6 Step 1 | Covered (engine must forward `agentId` — finding #1) |
| Engine spawn: resolve role, `prepareAgentSpawn`, log, `appendEvent`, then knowledge, then start/send | Task 6 | Partial (`agentId` forward, test updates — findings #1, #3) |
| `WorkflowEngineDeps` optional `logSpawn`, `appendEvent` | Task 6 | Covered |
| `freesolo start` default Implementer role, `host: input.tool` | Task 7 | Covered |
| `freesolo start` log spawn line + optional `agent.created` | Task 7 | Partial (log only — finding #2) |
| `src/team/index.ts` barrel | Tasks 1–5 | Covered (incremental exports per task) |
| Unit: `team-expand.test.ts` | Task 4 | Partial (findings #7) |
| Unit: `team-prompt.test.ts` | Task 2 | Covered |
| Unit: `team-spawn.test.ts` | Task 5 | Covered |
| Extend `workflow-engine.test.ts` — role prompt, log, `appendEvent` | Task 6 | Partial (findings #3, #6) |
| Extend `start-command.test.ts` — default Implementer in startup prompt | Task 7 | Covered |
| Non-goal: no Team Lifecycle Manager / permission enforcement / new event types / CLI `team spawn` | — | Respected |
| Non-goal: host adapters unchanged | — | Respected |
| Full `npm test` + `npm run build` verification | Task 8 | Covered |
