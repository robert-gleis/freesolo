# Issue #41 — Team Lifecycle Manager Design

**Issue:** [#41 — Team Lifecycle Manager](https://github.com/robert-gleis/issueflow/issues/41)
**Parent:** #9 — Epic: Team Orchestration
**Builds on:** #34 (Team Planner, closed), #33 (Agent Adapter Interface), #23 (Agent Event Log), #24 (Workflow Engine), ADR-0002
**Status:** Approved, implemented

## Summary

Add a **Team Lifecycle Manager** that owns the runtime lifecycle of agent teams produced by the Team Planner: create members from an approved `team-plan.json`, poll their status during execution, detect blocked or timed-out members, and tear down all members cleanly when work finishes or is cancelled. Every lifecycle transition is recorded in the Event Log.

v1 ships a `TeamLifecycleManager` domain module under `src/teams/`, a small CLI surface (`issueflow team start | status | stop`), and `ScriptedAgentAdapter`-based member factories for deterministic tests. Real host adapters plug in through the same factory injection point without changing manager logic.

## Goals

- Create team members from a schema-valid `TeamDefinition` read from `<.git>/issueflow/team-plan.json`.
- Monitor each member's `AgentAdapter.status()` on a poll loop: per-agent state, blocked detection, optional timeouts.
- Tear down all members cleanly on completion, cancellation, team-level timeout, or unrecoverable error.
- Emit typed lifecycle events to the Event Log for team creation, member start/stop, blocked detection, and teardown.
- Keep manager logic independent of Commander so a future runner can call `TeamLifecycleManager` directly.

## Non-Goals

- **Team planning.** Planner output is consumed, not produced. Schema ownership stays in #34 (`src/planner/`).
- **Real Pi / Claude / Codex / Cursor adapters.** v1 uses `ScriptedAgentAdapter` via an injectable factory. Concrete adapters are follow-up tickets.
- **Workflow engine policy changes.** v1 does not add a `spawn-team` engine action or modify `defaultPolicy`. Team start/stop is triggered explicitly via `issueflow team` CLI (same pattern as `issueflow plan generate` in #34). A runner ticket wires engine policy later.
- **Role-based work assignment (#42+).** Members receive `initialInstructions` derived from their role responsibility; routing messages between members is out of scope.
- **Process supervision / restart policies.** v1 stops members and surfaces errors; it does not restart crashed agents.
- **Cross-machine team coordination.** All members run in the same worktree process context.
- **Persisted team runtime recovery.** v1 keeps runtime state in memory plus an optional snapshot file for observability; crash recovery is a follow-up.

## Dependency Note

This worktree was forked before #34 (planner), #23 (event log), and several engine follow-ups landed on `main`. Implementation must merge or rebase onto branches containing:

- `src/planner/` — `TeamDefinition`, `readTeamPlan`, schema validation
- `src/event-log/` — `EventLog`, `append`, `EVENT_TYPES`
- `src/workflow/engine.ts` — unchanged in v1; referenced only for future integration

The spec is written against those merged interfaces, not the older worktree snapshot.

## Architecture

```
src/teams/
  types.ts          # TeamMember, TeamRuntimeState, TeamLifecycleConfig, event payload shapes
  members.ts        # expandTeamDefinition(definition) → TeamMemberSpec[]
  manager.ts        # TeamLifecycleManager — create, monitor, tearDown
  monitor.ts        # poll loop, blocked/timeout detection (pure helpers + async runner)
  events.ts         # map lifecycle transitions → EventLog.append inputs
  store.ts          # optional team-runtime.json snapshot (read/write via getIssueflowPath)
src/commands/
  team.ts           # registerTeamCommands — start, status, stop
```

Why a separate `src/teams/` directory:

- Mirrors `src/planner/` and `src/verification/` — domain logic outside CLI wiring.
- The workflow engine (or a future runner) imports `TeamLifecycleManager` without Commander.
- Unit tests inject fake adapters, clocks, and event logs without subprocesses.

### Relationship to existing abstractions

| Concept | Role in team lifecycle |
|---------|------------------------|
| `TeamDefinition` (#34) | Input artifact — which roles, hosts, counts, responsibilities |
| `AgentAdapter` (#33) | One adapter instance per team member; `start` / `stop` / `status` |
| `EventLog` (#23) | Durable telemetry for lifecycle transitions |
| `Runner` (#18) | **Not used in v1.** Adapters own process/session semantics; runners stay orthogonal |
| Workflow states | `approved → implementing` on `team start`; `implementing → approved` on cancel-before-work (optional v1) |

## Data Model

```ts
// src/teams/types.ts

import type { AgentHost, TeamDefinition } from '../planner/types.js';
import type { AgentState, AgentStatus } from '../agents/types.js';

export type TeamPhase =
  | 'idle'        // manager constructed, no team
  | 'creating'    // members starting
  | 'running'     // at least one member active, monitor loop active
  | 'tearing-down'
  | 'stopped';    // all members stopped, monitor finished

export interface TeamMemberSpec {
  memberId: string;       // stable id, e.g. "backend-engineer-1"
  roleName: string;
  host: AgentHost;
  responsibility: string;
  index: number;          // 1-based within role
}

export interface TeamMemberRuntime {
  spec: TeamMemberSpec;
  adapter: AgentAdapter;
  status: AgentStatus;
  blockedAt?: Date;
  blockedReason?: string;
}

export interface TeamRuntimeSnapshot {
  issueNumber: number;
  phase: TeamPhase;
  startedAt?: string;
  stoppedAt?: string;
  stopReason?: TeamStopReason;
  members: Array<{
    memberId: string;
    roleName: string;
    host: AgentHost;
    state: AgentState;
    blockedReason?: string;
  }>;
}

export type TeamStopReason =
  | 'completed'    // all members stopped cleanly while running
  | 'cancelled'    // explicit team stop
  | 'timeout'      // team-level or member blocked timeout
  | 'error';       // member entered error state

export interface TeamLifecycleConfig {
  pollIntervalMs: number;           // default 5_000
  memberBlockedTimeoutMs: number;   // default 1_800_000 (30 min)
  teamTimeoutMs?: number;           // optional overall cap
}
```

### Expanding roles to members

`expandTeamDefinition(definition: TeamDefinition): TeamMemberSpec[]` flattens `roles[].count` into individual members:

- `memberId` = `${slug(role.name)}-${index}` (slug: lowercase, non-alphanum → `-`, collapse repeats).
- `index` runs `1..count` per role.
- Order: declaration order of roles, then index ascending.

Example: `{ name: "Backend Engineer", count: 2 }` → `backend-engineer-1`, `backend-engineer-2`.

## TeamLifecycleManager

```ts
// src/teams/manager.ts

export interface AgentAdapterFactory {
  create(input: {
    member: TeamMemberSpec;
    workingDirectory: string;
  }): AgentAdapter;
}

export interface TeamLifecycleManagerDeps {
  worktreePath: string;
  issueNumber: number;
  adapterFactory: AgentAdapterFactory;
  eventLog: EventLog;
  config?: Partial<TeamLifecycleConfig>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
}

export class TeamLifecycleManager {
  create(definition: TeamDefinition): Promise<void>;
  monitor(): Promise<TeamStopReason>;   // blocks until stop condition; idempotent after stop
  tearDown(reason: TeamStopReason): Promise<void>;
  status(): TeamRuntimeSnapshot;
}
```

### create(definition)

1. Assert `phase === 'idle'`; otherwise throw `TeamLifecycleError` (`invalid-state`).
2. Set `phase = 'creating'`.
3. For each `TeamMemberSpec` from `expandTeamDefinition`:
   - `adapter = adapterFactory.create({ member, workingDirectory: worktreePath })`.
   - `adapter.start({ workingDirectory, initialInstructions: buildMemberPrompt(member) })`.
   - Record runtime entry; emit `agent.created` with payload `{ memberId, roleName, host, responsibility }`.
4. Set `phase = 'running'`, `startedAt = now()`.
5. Emit `team.created` with payload `{ issueNumber, memberCount, memberIds }`.
6. Write runtime snapshot to `<.git>/issueflow/team-runtime.json` (best-effort).

`buildMemberPrompt(member)` is a pure function: includes role name, responsibility, issue number, and instructs the agent to report progress via adapter activity (for `ScriptedAgentAdapter` tests, a script step acknowledges the prompt).

Start failures on individual members: mark that member `error`, emit `agent.stopped` with `{ reason: 'start-failed' }`, continue starting others. If **all** members fail to start, transition to `tearing-down` → `stopped` with `stopReason: 'error'` without entering `running`.

### monitor()

Poll loop while `phase === 'running'`:

1. For each member, `status = await adapter.status()`.
2. Update runtime snapshot.
3. **Blocked detection:** if `status.state === 'running'` and `lastActivityAt` is older than `memberBlockedTimeoutMs` (or missing and `startedAt` is older), mark member blocked, emit `team.member.blocked` with `{ memberId, reason: 'inactivity' }`.
4. **Error detection:** if `status.state === 'error'`, emit `team.member.blocked` with `{ memberId, reason: 'error', error: status.error }`. v1 does not auto-stop the team on a single error unless configured — default: continue monitoring, surface in `team status`. Team stop on error is triggered only when **all** members are `error` or `stopped`.
5. **Completion:** if every member is `stopped`, call internal `tearDown('completed')` and return.
6. **Team timeout:** if `teamTimeoutMs` set and elapsed since `startedAt`, call `tearDown('timeout')` and return.
7. **Member blocked timeout:** if any member has been blocked longer than `memberBlockedTimeoutMs`, call `tearDown('timeout')` and return.
8. `await sleep(pollIntervalMs)`; repeat.

`monitor()` is safe to call once; concurrent calls throw `invalid-state`.

### tearDown(reason)

1. If already `stopped`, return (idempotent).
2. Set `phase = 'tearing-down'`.
3. Emit `team.tearing-down` with `{ reason }`.
4. For each member not already `stopped` / `idle`: `await adapter.stop()` (best-effort, collect errors).
5. Emit `agent.stopped` per member with `{ memberId, reason }`.
6. Set `phase = 'stopped'`, `stoppedAt = now()`, `stopReason = reason`.
7. Emit `team.torn-down` with `{ reason, memberCount }`.
8. Update runtime snapshot.

Stop errors on individual members are swallowed after recording in snapshot; teardown always reaches `stopped`.

## Event Log Integration

Extend `EVENT_TYPES` in `src/event-log/types.ts`:

```ts
| 'team.created'
| 'team.member.blocked'
| 'team.tearing-down'
| 'team.torn-down'
```

Existing types reused:

- `agent.created` — member started
- `agent.stopped` — member stopped

All team events set `issueId` to the issue number. `agentId` is the `memberId` string for member-scoped events; `null` for team-level events (`team.created`, `team.torn-down`).

Payload shapes are documented in `src/teams/events.ts` as pure builder functions (`buildTeamCreatedEvent`, etc.) so tests assert exact payloads without touching SQLite.

## Persistence

`src/teams/store.ts`:

- `getTeamRuntimePath(worktreePath)` → `getIssueflowPath(worktreePath, 'team-runtime.json')`.
- `writeTeamRuntimeSnapshot(path, snapshot)` — pretty-printed JSON, updated after create, each monitor tick, and teardown.
- `readTeamRuntimeSnapshot(path)` — for `team status` CLI; returns `null` if absent.

The snapshot is **observability only** — the manager does not reload from disk on construction in v1.

## CLI Surface

Register in `src/cli.ts`:

```
issueflow team start  --issue <N>   # read team-plan.json, create team, approved → implementing
issueflow team status --issue <N>   # print runtime snapshot (from manager or team-runtime.json)
issueflow team stop   --issue <N>   # tearDown('cancelled')
```

`--issue` optional when session exists (reuse `resolveIssueNumber`).

### `team start`

1. Resolve issue number, worktree path, repo ref.
2. Read workflow state; must be `approved`.
3. `readTeamPlan(worktreePath)` — must exist and validate.
4. Construct `TeamLifecycleManager` with default `ScriptedAgentAdapter` factory in tests / injectable in CLI deps.
5. `manager.create(definition)`.
6. `writeState(repo, issue, 'approved', 'implementing')` with `ISSUEFLOW_ENGINE=1`.
7. Print summary: `team started: N members`.
8. **Does not** block in the monitor loop — a future runner calls `monitor()`. For manual/local use, document that `team status` polls the snapshot; a `team run` command that wraps `create + monitor` is a follow-up.

### `team status`

1. Read `team-runtime.json` if present; else print `no active team` and exit `2`.
2. Pretty-print JSON snapshot to stdout.

### `team stop`

1. Load manager state or read snapshot to confirm a team was started.
2. `tearDown('cancelled')`.
3. Print: `team stopped (cancelled)`.

Exit codes mirror `plan` commands: `0` success, `1` validation/state error, `3` engine gate, `4` malformed state labels.

## Error Handling

| Error | When | Behaviour |
|-------|------|-----------|
| `TeamPlanNotFoundError` | start with no team-plan.json | stderr, exit `1` |
| `TeamLifecycleError` (`invalid-state`) | create when not idle, monitor twice | stderr, exit `1` |
| `InvalidTransitionError` | wrong workflow state for start | stderr with allowed transitions, exit `1` |
| Engine gate | `ISSUEFLOW_ENGINE` not set on state write | stderr gate message, exit `3` |
| Partial start failure | some members fail | team still starts if ≥1 member running; snapshot shows per-member errors |

## Testing

Unit tests under `tests/unit/`:

- `team-members.test.ts` — `expandTeamDefinition` slugging, counts, ordering.
- `team-monitor.test.ts` — blocked detection, completion, timeout helpers (fake clock).
- `team-lifecycle-manager.test.ts` — full create/monitor/tearDown with `ScriptedAgentAdapter` factory; inactivity timeout; cancel; all-members-stopped completion; event log assertions via in-memory `EventLog`.
- `team-events.test.ts` — payload builders.
- `team-command.test.ts` — CLI wiring with injected deps: start/status/stop, engine gate, state guards.

No integration tests against real GitHub, SQLite files on disk, or real agent processes.

## Acceptance Criteria Mapping

| Issue criterion | How this design satisfies it |
|-----------------|------------------------------|
| Teams created from planner output | `create(readTeamPlan())` expands `TeamDefinition` into started adapters |
| Teams monitored (per-agent status, blocked detection, timeouts) | `monitor()` poll loop with `status()`, inactivity blocked detection, optional team timeout |
| Teams torn down cleanly when finished or cancelled | `tearDown()` stops all adapters; triggered on completion, `team stop`, or timeout |
| Lifecycle events emitted to event log | `team.created`, `agent.created`, `team.member.blocked`, `team.tearing-down`, `agent.stopped`, `team.torn-down` |

## Approaches Considered

### A. Engine-integrated `spawn-team` action (deferred)

Add `{ kind: 'spawn-team'; definition; nextState }` to `EngineAction` and teach `defaultPolicy` to return it in `approved`. Rejected for v1 because #34 established the pattern of explicit CLI commands for human-gated steps, and the runner ticket that loops `engine.tick()` does not exist yet. The manager module is built now; engine wiring is a one-line policy change later.

### B. Runner-based members (rejected)

Spawn each member via `Runner.spawn()` instead of `AgentAdapter`. Rejected because CONTEXT.md defines an **Agent** as a Host driven through an **Adapter**; the planner already assigns hosts at the adapter level. Runners remain an implementation detail inside future real adapters.

### C. Separated teams module + CLI (recommended)

`src/teams/` owns lifecycle logic; `src/commands/team.ts` wires Commander. Matches #34 and verification patterns. **Chosen.**

## Risks & Open Questions

- **Monitor loop ownership.** v1 CLI starts the team but does not run `monitor()` inline. The spec assumes a future runner process calls `monitor()`. If we need end-to-end manual testing in v1, add `issueflow team run` as a thin `create + monitor` wrapper — left as follow-up unless user wants it in scope.
- **Blocked vs working.** Inactivity timeout may false-positive on long-thinking agents. v1 uses a generous default (30 min); real adapters should update `lastActivityAt` on progress.
- **Event type schema migration.** Adding four `team.*` event types requires updating `EVENT_TYPES` and migration version. Coordinate with #23's schema versioning rules.

## Recommendation

Ship the separated `src/teams/` module with `TeamLifecycleManager`, event log integration, runtime snapshot file, and three CLI subcommands (`start`, `status`, `stop`). Use `ScriptedAgentAdapter` for all unit tests and as the default factory in development. Merge dependency branches before implementation.
