# Issue #34 — Team Planner Design

**Issue:** [#34 — Team Planner](https://github.com/robert-gleis/freesolo/issues/34)
**Parent:** #9 — Epic: Team Orchestration
**Builds on:** #24 (Workflow Engine, merged), #33 (Agent Adapter Interface, merged), ADR-0002 (LLM planner via AgentAdapter)
**Status:** Approved, implemented

## Summary

Add a team planner that analyses a GitHub issue and produces a structured team definition — which roles are needed, how many of each, which agent host runs each role, and what each role is responsible for. The planner runs through the standard `AgentAdapter` interface, validates its output against a JSON schema, persists the result to `<.git>/freesolo/team-plan.json`, and exposes CLI commands to inspect, edit, and approve the plan. Approval drives the existing `planned → approved` workflow state transition.

v1 ships a deterministic `ScriptedAgentAdapter`-based planner for tests and local development. Real LLM-backed adapters (Pi, Claude Code, Codex, Cursor) plug in through the same `AgentAdapter` injection point without changing planner logic.

## Goals

- Generate a schema-valid `TeamDefinition` from issue analysis via an `AgentAdapter`-conformant planner.
- Persist team plans at `<.git>/freesolo/team-plan.json` (resolved with `git rev-parse --git-path freesolo/team-plan.json`).
- Expose `freesolo plan show`, `freesolo plan edit`, and `freesolo plan approve` CLI subcommands.
- On successful generation, transition the GitHub issue from `triaged → planned`.
- On approval, transition from `planned → approved` after schema validation.
- Keep planner logic independent of the workflow engine so a future runner can call `runTeamPlanner()` directly.

## Non-Goals

- **Real LLM adapters.** v1 uses `ScriptedAgentAdapter` as the default injectable agent. Concrete Pi/Claude/Codex/Cursor planner adapters are follow-up tickets.
- **Autonomous auto-approval (#45).** Human approval is required in v1; autonomous mode is a separate ticket.
- **Team Lifecycle Manager (#41).** This ticket produces the JSON artifact; spawning and supervising team members is out of scope.
- **Engine policy changes.** The default `defaultPolicy` stays `wait` for `triaged`. Generation is triggered explicitly via `freesolo plan generate`, not by `engine tick`.
- **Event log persistence.** No `team.planned` event writer in v1; the state label change is the durable record.
- **Decomposition planning.** Output is team composition only, not issue breakdown.

## Architecture

```
src/planner/
  types.ts       # TeamDefinition, TeamRole, AgentHost
  schema.ts      # Zod schema + parseTeamDefinition()
  store.ts       # readTeamPlan / writeTeamPlan via getFreesoloPath
  runner.ts      # runTeamPlanner — prompt, agent.send, extract JSON, validate, persist
  prompt.ts      # buildPlannerPrompt(issue) — pure string builder
src/commands/
  plan.ts        # registerPlanCommands — generate, show, edit, approve
```

Why a separate `src/planner/` directory:

- Mirrors `src/verification/` and `src/agents/` — domain logic lives outside CLI wiring.
- The workflow engine (or a future runner) can import `runTeamPlanner` without pulling Commander.
- Unit tests inject fake agents and filesystem deps without spawning subprocesses.

### Data model

```ts
// src/planner/types.ts

export type AgentHost = 'pi' | 'claude' | 'codex' | 'cursor';

export interface TeamRole {
  name: string;
  host: AgentHost;
  responsibility: string;
  count: number; // positive integer
}

export interface TeamDefinition {
  roles: TeamRole[];
}
```

JSON on disk matches the issue's output schema exactly. `roles` must contain at least one entry.

### Schema validation

`src/planner/schema.ts` exports:

- `teamDefinitionSchema` — Zod object matching `TeamDefinition`.
- `parseTeamDefinition(input: unknown): TeamDefinition` — throws `TeamPlanValidationError` with a human-readable message on failure.
- `validateTeamPlanFile(contents: string): TeamDefinition` — parse JSON then validate.

Validation rules:

- `roles` is a non-empty array.
- Each `name` and `responsibility` is a non-empty string.
- Each `host` is one of `pi | claude | codex | cursor`.
- Each `count` is a positive integer (`>= 1`).

### Persistence

`src/planner/store.ts`:

- `getTeamPlanPath(worktreePath)` — resolves via `getFreesoloPath(worktreePath, 'team-plan.json')`.
- `readTeamPlan(worktreePath)` — returns `TeamDefinition` or throws `TeamPlanNotFoundError`.
- `writeTeamPlan(worktreePath, definition)` — writes pretty-printed JSON (2-space indent) and creates parent dirs.

The file lives in the git dir (worktree-local), not in the tracked repo tree — same pattern as `session.json` and `current-issue.md`.

### Planner runner

`runTeamPlanner(input)` orchestrates:

1. Build a prompt from issue metadata (`buildPlannerPrompt`).
2. `agent.start({ workingDirectory, initialInstructions: prompt })`.
3. `agent.send(prompt)`.
4. Extract JSON from `response.output` (see extraction rules below).
5. `parseTeamDefinition(extracted)`.
6. `writeTeamPlan(worktreePath, definition)`.
7. `agent.stop()` (best-effort; errors swallowed).

```ts
// src/planner/runner.ts

export interface RunTeamPlannerInput {
  worktreePath: string;
  issue: { number: number; title: string; body: string };
  agent: AgentAdapter;
}

export interface RunTeamPlannerResult {
  definition: TeamDefinition;
  teamPlanPath: string;
}

export class TeamPlannerError extends Error {
  readonly code: 'agent-failed' | 'invalid-json' | 'validation-failed';
}
```

**JSON extraction from agent output:**

1. If output contains a ` ```json ` fenced block, parse the first one.
2. Otherwise, parse the entire trimmed output as JSON.
3. On parse failure, throw `TeamPlannerError` with code `invalid-json`.

**Prompt shape (v1):**

The prompt instructs the agent to return *only* a JSON object matching the schema, with example structure. It includes the issue number, title, and body. `buildPlannerPrompt` is a pure function tested independently.

**Default agent for CLI/tests:**

`ScriptedAgentAdapter` with a script step that matches the prompt (regex) and returns a deterministic valid `TeamDefinition` JSON string. This makes `plan generate` fully testable without network or subprocess.

### State transitions

State writes use the existing `writeState` from `src/workflow/state-store.ts`, gated the same way as `freesolo state transition`:

- `plan generate` transitions `triaged → planned` after a successful write. Requires current state to be `triaged`; otherwise prints an error and exits non-zero.
- `plan approve` transitions `planned → approved` after schema validation. Requires current state to be `planned`.

Both commands check `FREESOLO_ENGINE=1`. Without it, print a clear error (matching the engine-gate message style) and exit `3`. This keeps agents from bypassing the engine in production while allowing tests to set the env var.

Neither command invents state: if the issue has no `state:*` label, exit with an error.

## CLI Surface

New command group registered in `src/cli.ts`:

```
freesolo plan generate --issue <N>   # run planner, write team-plan.json, triaged → planned
freesolo plan show     --issue <N>   # print team-plan.json to stdout
freesolo plan edit     --issue <N>   # open team-plan.json in $EDITOR, re-validate on save
freesolo plan approve  --issue <N>   # validate schema, planned → approved
```

`--issue` is optional when a session exists in the worktree (reuse `resolveIssueNumber` from `src/core/issue-id.ts`).

### `plan generate`

1. Resolve issue number and repo ref.
2. Read current workflow state; must be `triaged`.
3. Fetch issue title/body from GitHub (`gh issue view`) or from `current-issue.md` packet as fallback.
4. Run `runTeamPlanner` with the injected agent.
5. `writeState(repo, issue, 'triaged', 'planned')` (with `FREESOLO_ENGINE=1`).
6. Print one-line summary: `team plan written: <path>`.

Exit codes: `0` success, `1` planner/validation/state error, `3` engine gate, `4` malformed state labels.

### `plan show`

1. Read `team-plan.json`.
2. Pretty-print JSON to stdout.

Exit codes: `0` success, `1` file not found or invalid JSON, `2` no issue resolved.

### `plan edit`

1. Read existing `team-plan.json` (must exist).
2. Write contents to a temp file, spawn `$EDITOR` (default `vi` if unset).
3. On editor exit, read temp file, `validateTeamPlanFile`, write back to `team-plan.json`.
4. On validation failure, restore original file and print error.

Does not change workflow state. Human edits stay in `planned` until explicit approval.

### `plan approve`

1. Read and validate `team-plan.json`.
2. Read current state; must be `planned`.
3. `writeState(repo, issue, 'planned', 'approved')` (with `FREESOLO_ENGINE=1`).
4. Print: `planned -> approved`.

Exit codes: `0` success, `1` validation/state error, `3` engine gate.

## Error handling

| Error | When | User-visible behaviour |
|-------|------|------------------------|
| `TeamPlanNotFoundError` | show/edit/approve with no file | stderr message, exit `1` |
| `TeamPlanValidationError` | invalid schema on read/edit/approve | stderr with Zod path details, exit `1` |
| `TeamPlannerError` | agent or JSON extraction failed | stderr with code + message, exit `1` |
| `InvalidTransitionError` | wrong current state for generate/approve | stderr with allowed transitions, exit `1` |
| Engine gate | `FREESOLO_ENGINE` not set | stderr gate message, exit `3` |

## Testing

Unit tests under `tests/unit/` (flat, matching repo convention):

- `team-plan-schema.test.ts` — valid/invalid payloads, edge cases (empty roles, bad host, zero count).
- `team-plan-store.test.ts` — read/write round-trip, not-found error, path resolution.
- `team-planner-prompt.test.ts` — prompt includes issue fields.
- `team-planner-runner.test.ts` — full runner with `ScriptedAgentAdapter`: happy path, invalid JSON, validation failure, agent contract violation.
- `plan-command.test.ts` — CLI wiring with injected deps: generate/show/edit/approve paths, engine gate, state guards, exit codes.

No integration tests against real GitHub or real LLM processes. CLI tests inject fake `readState`/`writeState`/`runTeamPlanner` deps.

## Acceptance Criteria Mapping

| Issue criterion | How this design satisfies it |
|-----------------|--------------------------------|
| Team definition generated via AgentAdapter-conformant planner | `runTeamPlanner` accepts `AgentAdapter`; v1 default is `ScriptedAgentAdapter`. |
| Output conforms to JSON schema and is validated before use | Zod schema in `schema.ts`; validated on generate, edit save, and approve. |
| Output written to `<.git>/freesolo/team-plan.json` | `store.ts` uses `getFreesoloPath`. |
| Plans inspectable/overridable via `freesolo plan` CLI | `show`, `edit`, `approve` subcommands as specified. |
| Approval drives `planned → approved` | `plan approve` calls `writeState` after validation. |

## Approaches Considered

### A. Monolithic CLI module (rejected)

Put schema, I/O, agent orchestration, and Commander wiring in `src/commands/plan.ts`. Rejected because it duplicates the verification module's lesson — untestable CLI blobs — and blocks engine reuse.

### B. Separated planner module + CLI (recommended)

`src/planner/` owns domain logic; `src/commands/plan.ts` wires Commander. Matches existing patterns (#24 engine, verification runner). **Chosen.**

### C. Engine-integrated generation only (rejected)

Trigger planning via `engine tick` spawn when state is `triaged`. Rejected because the issue specifies explicit `freesolo plan` CLI commands and ADR-0002 treats planner output as a human-reviewable proposal. Explicit `plan generate` keeps the human-in-the-loop flow clear.

## Risks & Open Questions

- **Real adapter quality.** LLM output may not be valid JSON. Extraction heuristics help but real adapters may need retry logic — deferred to the LLM adapter ticket.
- **`pi` host value.** `HostTool` in `src/core/types.ts` omits `pi`; team plan schema includes it per the issue. No conflict — team plans describe future hosts, not the current session host.
- **Issue body fetch.** `plan generate` needs issue content. v1 uses `gh issue view --json title,body` with packet fallback when `gh` is unavailable in tests.

## Recommendation

Ship the separated planner module with `ScriptedAgentAdapter` as the default agent, four CLI subcommands (`generate`, `show`, `edit`, `approve`), and engine-gated state transitions. This satisfies all acceptance criteria, dogfoods `AgentAdapter` per ADR-0002, and leaves a clean injection point for real LLM adapters.
