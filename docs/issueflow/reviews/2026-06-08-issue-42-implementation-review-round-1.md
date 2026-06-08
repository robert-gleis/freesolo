# Implementation Review Round 1 — Issue #42

**Issue:** [#42 — Role-Based Agent Assignment](https://github.com/robert-gleis/issueflow/issues/42)  
**Spec:** `docs/issueflow/specs/2026-06-08-issue-42-design.md`  
**Plan:** `docs/issueflow/plans/2026-06-08-issue-42-plan.md`

## Verdict

`pass_with_findings`

## Findings

### 🟡 Suggestion — Engine test does not assert custom `agentId` in log or event (`tests/unit/workflow-engine.test.ts`)

The test `uses explicit role and agentId from the spawn action when provided` verifies role-framed prompt content but does not assert that `custom-agent-id` appears in `logSpawn` output or `appendEvent` payload. Implementation **does** forward `action.agent.agentId` into `prepareAgentSpawn` (`src/workflow/engine.ts:191`), and `team-spawn.test.ts` covers explicit `agentId` at the module level.

**Impact:** Regression in `agentId` forwarding through the engine spawn path could slip through CI.

**Recommendation:** Extend the engine test to assert `logLines[0]` and `appended[0].agentId` when `logSpawn` / `appendEvent` deps are provided.

---

### 🟡 Suggestion — `appendEvent` is injectable but not wired in production defaults (`src/commands/start.ts`, `src/workflow/engine.ts`)

Both spawn paths call `deps.appendEvent?.(...)` / `appendEvent?.(...)` only when callers inject the dep. `defaultDeps` in `start.ts` does not include `appendEvent`; no production engine factory wires it yet. The spec explicitly flags this as acceptable for v1 (#41 follow-up).

**Impact:** `agent.created` events with role payloads will not appear in SQLite until a caller wires `appendEvent`. Stderr spawn logs still satisfy the logging acceptance criterion.

**Recommendation:** Document in #41 lifecycle work, or add a thin production wiring follow-up. No change required for this ticket.

---

### 🟡 Suggestion — `agent.stopped` helper exported but not consumed (`src/team/spawn.ts`)

`buildAgentStoppedPayload(role)` returns `{ roleName }` per spec convention and is unit-tested, but no spawn/stop path emits `agent.stopped` yet. Consistent with non-goal “Team Lifecycle Manager (#41)”.

**Impact:** None for v1 acceptance criteria. Convention is preserved for #41.

**Recommendation:** Use `buildAgentStoppedPayload` when lifecycle teardown lands in #41.

---

### 🟢 Nice-to-have — `defaultSpawnHost` fallback may mismatch session host (`src/workflow/engine.ts:188-189`)

When policy omits `role`, the engine defaults to `buildDefaultImplementerRole(deps.defaultSpawnHost ?? 'cursor')`. Callers on non-Cursor sessions must set `defaultSpawnHost` or supply an explicit `role` to avoid `host=cursor` in logs/events while running Claude/Codex adapters. Spec documents this risk; `issueflow start` correctly uses `input.tool`.

**Recommendation:** Future policies should pass explicit roles from `expandTeamPlan`; consider reading session `chosenHost` when engine gains session context.

---

### 🟢 Nice-to-have — Start integration test does not assert role-before-knowledge ordering (`tests/integration/start-command.test.ts`)

`appends knowledge entries to the startup prompt in print-only mode` checks kernel and knowledge sections but not `## Your Role`. Ordering is covered in `workflow-engine.test.ts` (`enriches spawn instructions with knowledge entries before start and send`).

**Recommendation:** Optional one-liner: `expect(promptArg).toContain('## Your Role')` and assert role section index precedes `## Factory Knowledge Base`.

---

### 🟢 Nice-to-have — Full test suite has pre-existing unrelated failures

`npm test` reports 2 failures outside issue #42 scope:

- `tests/unit/local-process-runner.test.ts` — log truncation
- `tests/integration/verify-command.test.ts` — SIGINT recording

All issue #42 tests (59 across team, engine, start, adapter integration) pass. `npm run build` passes.

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| 1. Every agent spawned with an explicit role | **Met** | `prepareAgentSpawn` requires `role`. Engine resolves `action.agent.role ?? buildDefaultImplementerRole(defaultHost)` (`engine.ts:189-196`). `createStartPlan` uses `buildDefaultImplementerRole(input.tool)` (`start.ts:393-397`). `AgentTaskRequest` gains optional `role` / `agentId` (`policy.ts:11-16`). |
| 2. Role visible in logs and event log | **Met** | `formatAgentSpawnLog` produces spec-shaped stderr line (`log.ts:3-6`). Engine calls `deps.logSpawn?.(spawn.logLine)`; start calls `console.error(spawn.logLine)`. Both append `agent.created` with full payload (`roleName`, `responsibility`, `host`, `instanceIndex`, `instanceCount`, `workingDirectory`) when `appendEvent` is injected. Tests: `team-spawn.test.ts`, `workflow-engine.test.ts` (logSpawn + appendEvent), `start-command.test.ts` (appendEvent). |
| 3. Role drives prompt at spawn time | **Met** | `buildRolePrompt` prepends `## Your Role` before base instructions (`prompt.ts:3-21`). Knowledge appended after role framing in both paths (`engine.ts:207-208`, `start.ts:406-407`). Tests verify role section in adapter prompts and ordering before `## Factory Knowledge Base` (`workflow-engine.test.ts`, `claude-code-workflow-integration.test.ts`, `codex-agent-workflow-integration.test.ts`, `start-command.test.ts`). |

## Plan & Spec Alignment

| Area | Status |
|---|---|
| `src/team/types.ts` — `AgentRoleAssignment`, `TeamAgentSpawnSpec`, `RoleContextProfile` | Complete |
| `src/team/agent-id.ts` — `slugifyRoleName`, `buildAgentId` | Complete |
| `src/team/prompt.ts` — `buildRolePrompt` with instance suffix rules | Complete |
| `src/team/log.ts` — `formatAgentSpawnLog` | Complete |
| `src/team/expand.ts` — `expandTeamPlan` | Complete (library API; not wired to spawn paths — per spec non-goals) |
| `src/team/spawn.ts` — `prepareAgentSpawn`, `buildDefaultImplementerRole`, `buildAgentStoppedPayload` | Complete |
| `src/team/index.ts` barrel | Complete |
| `AgentTaskRequest` optional `role`, `agentId` | Complete |
| Engine spawn wiring — role resolve, `prepareAgentSpawn`, log, appendEvent, knowledge, start/send | Complete |
| `WorkflowEngineDeps` — `logSpawn`, `appendEvent`, `defaultSpawnHost` | Complete |
| `issueflow start` — default Implementer, spawn log, optional `appendEvent`, role-before-knowledge | Complete |
| Unit tests — `team-agent-id`, `team-prompt`, `team-expand`, `team-spawn` | Complete |
| Extended `workflow-engine.test.ts`, `start-command.test.ts`, adapter integration tests | Complete |
| Non-goals respected (no lifecycle manager, no permission enforcement, no new event types, no CLI subcommands) | Yes |

## Verification

| Command | Result |
|---|---|
| `npm run build` | **pass** |
| Issue #42 scoped tests (team, engine, start, adapter integration) | **59/59 pass** |
| `npm test` (full suite) | **743/745 pass** — 2 pre-existing unrelated failures |

## Summary

Implementation delivers the planned `src/team/` module and wires both spawn paths (`workflow engine`, `issueflow start`) through `prepareAgentSpawn()`. All three issue acceptance criteria are satisfied: every spawn resolves an explicit role (custom or default Implementer), role appears in structured stderr logs and optional `agent.created` payloads, and role framing precedes knowledge injection in agent instructions.

Findings are test-coverage and production-wiring gaps that match documented v1 deferrals (#41 lifecycle, optional event log). None block merge for issue #42.

STATUS=pass_with_findings
