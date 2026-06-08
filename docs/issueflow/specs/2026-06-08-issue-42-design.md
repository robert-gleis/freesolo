# Issue #42 — Role-Based Agent Assignment Design

**Issue:** [#42 — Role-Based Agent Assignment](https://github.com/robert-gleis/issueflow/issues/42)
**Parent:** #9 — Epic: Team Orchestration
**Builds on:** #33 (Agent Adapter Interface, merged), #34 (Team Planner, merged), #22 (Knowledge Base, merged), #23 (Event Log, merged)
**Status:** Approved, implemented

## Summary

Introduce an explicit role assignment layer so every spawned agent carries a `TeamRole`-derived identity that shapes its startup prompt, appears in structured logs, and is recorded in the `agent.created` event payload. A new `src/team/` domain module expands an approved `team-plan.json` into per-agent spawn specifications, builds role-framed prompts, and exposes a single `prepareAgentSpawn()` entry point consumed by both the workflow engine and future Team Lifecycle Manager (#41).

v1 ships role types, team-plan expansion, prompt framing, log formatting, event-log payload conventions, engine wiring, and a default single-agent role for `issueflow start`. Full permission enforcement (tool/MCP gating) and multi-agent supervision are out of scope — roles are recorded and prompt-shaped in v1; lifecycle orchestration lands with #41.

## Goals

- Every agent spawn path attaches an explicit `AgentRoleAssignment` (role name, responsibility, host, instance index).
- Role drives prompt composition at spawn time via a dedicated `buildRolePrompt()` builder layered before knowledge-base injection.
- Role is visible in stderr logs (`[issueflow] spawn agent=… role=…`) and in `agent.created` event payloads.
- Expand `TeamDefinition.roles[]` (with `count > 1`) into distinct per-agent spawn specs with stable `agentId` values.
- Keep spawn orchestration out of `src/workflow/` internals beyond a thin call to `prepareAgentSpawn()`.

## Non-Goals

- **Team Lifecycle Manager (#41).** v1 does not create, monitor, or tear down multi-agent teams. It produces spawn-ready specs and wires the single-agent engine path; #41 will call the same `prepareAgentSpawn()` API.
- **Permission enforcement.** v1 records `host` on the role and documents a `RoleContextProfile` shape for future knowledge filtering. No MCP/tool allowlists or workflow-state ACLs in this ticket.
- **New event types.** Reuse `agent.created` / `agent.stopped` with enriched payloads; do not add `team.member.spawned` until #41 needs it.
- **Real host adapter changes.** Role framing is host-agnostic prompt text; Cursor/Codex/Claude adapters stay unchanged.
- **CLI subcommands.** No `issueflow team spawn` in v1. Expansion and prompt building are library APIs tested directly.
- **Workflow state label changes.** GitHub `state:*` labels are untouched.

## Considered Options

### A. Extend `AgentTaskRequest` only (minimal)

Add `role` and `agentId` fields to `AgentTaskRequest`, build role prompt inline in `engine.ts`, emit events there.

**Pros:** Smallest diff.
**Cons:** No team-plan expansion; engine accumulates orchestration logic; hard for #41 to reuse.

### B. `src/team/` module with `prepareAgentSpawn()` (recommended)

New domain module owns role types, team expansion, prompt framing, log lines, and event payload shaping. Engine and `start` import from `src/team/index.ts`.

**Pros:** Matches `src/planner/`, `src/verification/` patterns; clean handoff to #41; testable in isolation.
**Cons:** Slightly more files than A.

### C. Embed role logic in `src/planner/`

Extend planner store/runner to also spawn agents.

**Rejected:** Planner produces plans; spawning is a separate lifecycle concern per CONTEXT.md separation.

**Chosen: B.**

## Architecture

```
src/team/
  types.ts       # AgentRoleAssignment, TeamAgentSpawnSpec, RoleContextProfile
  expand.ts      # expandTeamPlan(definition) → TeamAgentSpawnSpec[]
  prompt.ts      # buildRolePrompt(role, baseInstructions)
  spawn.ts       # prepareAgentSpawn(input) → { agentId, role, instructions, logLine, eventPayload }
  log.ts         # formatAgentSpawnLog(spec)
  index.ts       # barrel

src/workflow/
  policy.ts      # AgentTaskRequest gains role + agentId (optional for backward compat)
  engine.ts      # calls prepareAgentSpawn before knowledge injection; emits agent.created

src/commands/
  start.ts       # assigns default Implementer role to single-agent sessions
```

Why `src/team/`:

- Epic #9 is Team Orchestration; role assignment is the bridge between planner output (#34) and lifecycle management (#41).
- Mirrors `src/planner/` — domain logic outside CLI and outside engine internals.
- Engine isolation regression tests can forbid `src/team/` imports from engine policy if needed; engine may import `prepareAgentSpawn` as an orchestration helper (same pattern as knowledge loader).

### Data model

```ts
// src/team/types.ts

import type { PlannerHost } from '../planner/schemas/team-definition.js';

/** One agent's role assignment at spawn time. Derived from TeamRole + instance index. */
export interface AgentRoleAssignment {
  roleName: string;
  responsibility: string;
  host: PlannerHost;
  /** 1-based index when count > 1, e.g. "Backend Engineer (2/3)". */
  instanceIndex: number;
  instanceCount: number;
}

/** Fully resolved spawn spec for one agent instance. */
export interface TeamAgentSpawnSpec {
  agentId: string;
  role: AgentRoleAssignment;
  workingDirectory: string;
  baseInstructions: string;
}

/** Optional future hook for role-specific knowledge filtering (#41+). v1 is pass-through. */
export interface RoleContextProfile {
  roleName: string;
  /** Reserved: glob patterns under .issueflow/knowledge/ to include. Empty = all. */
  knowledgeInclude?: string[];
}
```

`agentId` format: `agent-{issueNumber}-{slugifiedRoleName}-{instanceIndex}` (lowercase, non-alphanumeric → `-`, collapsed). Example: `agent-42-backend-engineer-1`.

### Team plan expansion

`expandTeamPlan(definition: TeamDefinition, input: { issueNumber: number; workingDirectory: string; baseInstructions: string })`:

- For each `TeamRole` in `definition.roles`, emit `count` specs.
- Each spec gets a distinct `AgentRoleAssignment` with `instanceIndex` / `instanceCount`.
- All specs share `workingDirectory` and `baseInstructions` in v1 (per-role worktrees are #41).

### Prompt composition

Order at spawn time (outermost last appended):

1. `baseInstructions` — caller-supplied task or workflow kernel.
2. `buildRolePrompt(role, base)` — inserts a `## Your Role` section **before** base instructions.
3. `appendKnowledgeToPrompt(...)` — existing knowledge-base injection (#22).

`buildRolePrompt` shape:

```markdown
## Your Role

You are the **{roleName}** ({instanceIndex}/{instanceCount}) on this issue's team.

**Responsibility:** {responsibility}

Stay within your role scope. Coordinate through shared issue artifacts and the worktree.

---

{baseInstructions}
```

When `instanceCount === 1`, omit the `(1/1)` suffix in the heading for readability.

### Logging

`formatAgentSpawnLog(spec: TeamAgentSpawnSpec): string` returns a single stderr line:

```
[issueflow] spawn agent=agent-42-backend-engineer-1 role="Backend Engineer" host=cursor instance=1/1 cwd=/path/to/worktree
```

Engine and future lifecycle manager call `console.error(logLine)` (or inject a `log` dep) at spawn time.

### Event log payload

Extend the documented `agent.created` payload convention (no new `EventType`):

```json
{
  "roleName": "Backend Engineer",
  "responsibility": "Implement API endpoints and data models.",
  "host": "cursor",
  "instanceIndex": 1,
  "instanceCount": 1,
  "workingDirectory": "/path/to/worktree"
}
```

`agentId` remains the top-level `agent_id` column on the event row. `agent.stopped` payloads include `{ "roleName": "..." }` for correlation.

`prepareAgentSpawn()` returns `{ agentId, role, instructions, logLine, eventPayload }` so callers append events consistently.

### Integration points

#### Workflow engine (`src/workflow/engine.ts`)

On the `spawn` branch, before `agent.start`:

1. Resolve role from `action.agent.role` or default `DEFAULT_SINGLE_AGENT_ROLE` when absent (backward compat for tests/policies that omit role).
2. Call `prepareAgentSpawn({ agentId, role, workingDirectory, baseInstructions: action.agent.initialInstructions })`.
3. Log `logLine` to stderr.
4. Append `agent.created` via injected `appendEvent` dep (optional; no-op when event log unavailable in tests).
5. Load knowledge and call `agent.start` / `agent.send` with final `instructions`.

`WorkflowEngineDeps` gains optional `appendEvent?: (input: AppendEventInput) => void` and `logSpawn?: (line: string) => void` for testability.

#### `issueflow start` (`src/commands/start.ts`)

Before building the launch plan, construct a default role:

```ts
const defaultRole: AgentRoleAssignment = {
  roleName: 'Implementer',
  responsibility: 'Execute the issueflow workflow for this issue',
  host: input.tool, // mapped to PlannerHost
  instanceIndex: 1,
  instanceCount: 1
};
```

Log the spawn line and optionally append `agent.created` when event log is configured. Role prompt is applied to `startupPrompt` before knowledge injection.

#### `AgentTaskRequest` (`src/workflow/policy.ts`)

```ts
export interface AgentTaskRequest {
  agentId?: string;
  role?: AgentRoleAssignment;
  workingDirectory: string;
  initialInstructions: string;
}
```

Both fields optional for backward compatibility; engine applies defaults when missing.

## Acceptance Criteria Mapping

| Issue criterion | How this design satisfies it |
|---|---|
| Every agent is spawned with an explicit role | `AgentRoleAssignment` required at `prepareAgentSpawn()`; engine and `start` always resolve a role (explicit or default). |
| Role is visible in logs and the agent event log | `formatAgentSpawnLog` stderr line; `agent.created` payload includes `roleName`, `responsibility`, `host`, instance fields. |
| Role drives prompt / context selection at spawn time | `buildRolePrompt` prepended before knowledge injection; `RoleContextProfile` hook reserved for future knowledge filtering. |

## Testing

Unit tests under `tests/unit/` (flat, matching repo convention):

- `team-expand.test.ts` — single role, multi-count, multiple roles, agentId stability.
- `team-prompt.test.ts` — role section present, instance suffix rules, ordering with base instructions.
- `team-spawn.test.ts` — `prepareAgentSpawn` output shape, event payload, log line format.
- `workflow-engine.test.ts` (extend) — spawn path logs role, passes role-framed prompt to adapter, calls `appendEvent` when configured.
- `start-command.test.ts` (extend) — default Implementer role applied to startup prompt.

No integration tests against real hosts or SQLite in this ticket beyond existing patterns.

## Risks & Open Questions

- **Default role for legacy spawn paths.** Tests and policies that omit `role` get `Implementer`. Documented in spec; callers should pass explicit roles once #41 lands.
- **`host` on role vs session `chosenHost`.** Team plan may assign `claude` while session host is `cursor` for the orchestrator. v1 records both; #41 enforces host matching when spawning real adapters.
- **Event log optional in engine.** Engine tests today do not open SQLite. `appendEvent` is injected and optional; production wiring lands with #41 or a thin follow-up.
- **Permission enforcement deferred.** Issue mentions "permissions"; v1 is prompt + telemetry only. A follow-up ticket can add `RoleContextProfile.knowledgeInclude` filtering and MCP allowlists.

## Recommendation

Ship `src/team/` with expansion, prompt framing, logging, and event payload helpers; wire the workflow engine and `issueflow start` spawn paths; extend `AgentTaskRequest` with optional role fields. This satisfies all acceptance criteria, reuses `TeamDefinition` from #34, and leaves a clean API for Team Lifecycle Manager (#41).
