# Issue #33 — Agent Adapter Interface Design

## Summary

Define a uniform TypeScript interface, `AgentAdapter`, that the workflow engine (issue #24) will use to drive arbitrary agent backends — Pi, Claude Code, Codex, and future implementations. The interface covers the four lifecycle operations called out in the issue: `start`, `stop`, `send`, `status`. Ship one reference adapter (`ScriptedAgentAdapter`) that proves the interface is implementable and gives the future engine a deterministic test double.

This issue does **not** build the workflow engine and does **not** ship real Pi/Claude Code/Codex adapters — those are separate tickets under epic #8. The scope here is the contract and one validation implementation.

## Goals

- Make the workflow engine agent-agnostic by isolating all agent-specific knowledge behind an interface.
- Cover the full agent lifecycle (`start`, `stop`, `send`, `status`) without leaking implementation details into the contract.
- Provide one concrete adapter that exercises the interface and can be used as a test double.
- Keep the v1 surface intentionally small so real adapters (Pi, Claude Code, Codex) can be added without rewriting the contract.

## Non-Goals

- No workflow engine. The engine is issue #24 and is not in scope.
- No real Pi / Claude Code / Codex adapters. Each is its own follow-up ticket.
- No streaming responses, event emitters, or pub/sub on top of `send` in v1.
- No process supervision, restart policies, or crash recovery on top of `start/stop` in v1.
- No changes to the existing `src/adapters/` host-launcher modules — they solve a different problem (declarative CLI launch plans) and remain untouched.

## Architecture

The new code lives under `src/agents/`. Layout:

```
src/agents/
  types.ts          # AgentAdapter, AgentStatus, AgentState, AgentStartInput, AgentResponse, AgentScript, ScriptStep
  scripted.ts       # ScriptedAgentAdapter — the reference / test-double adapter
  index.ts          # Barrel re-export
```

Why a separate top-level directory:

- `src/adapters/` already exists and holds `LaunchPlanBuilder`s — pure declarative config builders that map `(worktreePath, prompt) → LaunchPlan`. They are one-shot, synchronous, and stateless.
- `AgentAdapter` is the opposite: stateful, async, owns a running session. Merging the two concepts would muddy both.
- The naming split (`adapters/` for host launchers, `agents/` for agent runtimes) gives later real adapters (`src/agents/claude-code.ts`, `src/agents/codex.ts`, `src/agents/pi.ts`) an obvious home.

The workflow engine (when it lands) will import only from `src/agents/index.ts` and never from concrete adapter modules.

## Interface

```ts
// src/agents/types.ts

export type AgentState =
  | 'idle'        // adapter constructed, start() never called
  | 'starting'    // start() in progress
  | 'running'     // started, ready to send
  | 'stopping'    // stop() in progress
  | 'stopped'     // terminated cleanly
  | 'error';      // unrecoverable failure; only stop() is allowed

export interface AgentStatus {
  state: AgentState;
  startedAt?: Date;
  lastActivityAt?: Date;
  error?: string;
}

export interface AgentStartInput {
  workingDirectory: string;
  initialInstructions?: string;
}

export interface AgentResponse {
  output: string;
}

export interface AgentAdapter {
  start(input: AgentStartInput): Promise<void>;
  stop(): Promise<void>;
  send(input: string): Promise<AgentResponse>;
  status(): Promise<AgentStatus>;
}
```

### Method contracts

`start(input)`
- Preconditions: state is `idle` or `stopped`. Any other state throws.
- Transitions: `idle|stopped` → `starting` → `running` on success; → `error` on failure (and the rejection contains the cause).
- Idempotency: not idempotent. Calling `start` twice without an intervening `stop` is a contract violation.

`stop()`
- Preconditions: any state.
- Transitions: `running|starting|error` → `stopping` → `stopped`. From `idle` or `stopped`, resolves immediately as a no-op.
- Must not throw on a no-op stop.

`send(input)`
- Preconditions: state is `running`. Any other state rejects with a typed error.
- Returns: `AgentResponse` carrying the agent's textual output. Updates `lastActivityAt`.
- v1 is single-response. Streaming is deferred.

`status()`
- Preconditions: none. Always resolves.
- Returns a snapshot — caller may not assume the values stay current.

### Errors

A single error class, `AgentAdapterError`, with a `code` discriminant: `invalid-state`, `start-failed`, `send-failed`, `stop-failed`. The reference adapter throws `AgentAdapterError` with `invalid-state` for contract violations. Real adapters extend the error set if needed but must keep `invalid-state` semantics consistent.

## Reference Adapter: ScriptedAgentAdapter

Purpose: a deterministic test double that validates the interface and will be reused by the workflow engine's tests once that engine exists.

```ts
// src/agents/scripted.ts

export interface ScriptStep {
  match: string | RegExp;     // matched against send() input; a string `match` is exact case-sensitive equality, use a RegExp for substring or case-insensitive matching
  output: string;             // returned in AgentResponse.output
}

export interface AgentScript {
  steps: ScriptStep[];
  fallback?: string;          // returned if no step matches; otherwise send rejects
}

export class ScriptedAgentAdapter implements AgentAdapter {
  constructor(script: AgentScript);
  // ...implements AgentAdapter
}
```

Behavior:

- `start` flips state to `running` and records `startedAt`. Throws `invalid-state` if already running.
- `send` walks `script.steps` in order, returns the first matching step's `output`. If no step matches, uses `fallback` or rejects with `send-failed`. Updates `lastActivityAt`.
- `stop` flips state to `stopped`. From any state, including `error`, resolves cleanly.
- `status` returns the current snapshot.

The adapter is intentionally trivial — it owns no subprocess, no I/O, no timers. Its only job is to prove the interface compiles, can be implemented, and behaves predictably enough to be a test fixture.

## Engine-Free Validation

The acceptance criterion "No agent-specific logic exists in the workflow engine" is satisfied trivially in this ticket because the workflow engine does not yet exist. To make the criterion non-vacuous, we add a forward-looking constraint to the spec:

> Any future code that imports a concrete adapter (`scripted.ts`, future `claude-code.ts`, etc.) must live outside `src/workflow/`. Engine code only imports from `src/agents/index.ts` and only the `AgentAdapter` type and helpers — never a concrete class.

This is enforced by review for now; a later ticket can add a lint rule once the engine exists.

## Testing

Unit tests live under `tests/unit/agents/`.

- `types.test.ts` — sanity-checks the interface is a structural type (compile-time only, captured via type assertions in the test file).
- `scripted.test.ts` — drives `ScriptedAgentAdapter` through every state transition and asserts:
  - Fresh adapter reports `idle`.
  - `start` moves to `running` and sets `startedAt`.
  - `send` returns the matching script step's output and updates `lastActivityAt`.
  - `send` with no matching step uses `fallback` if present.
  - `send` with no match and no fallback rejects with `send-failed`.
  - `send` before `start` rejects with `invalid-state`.
  - `start` twice without `stop` rejects with `invalid-state`.
  - `stop` from any state resolves; resulting state is `stopped`.
  - `stop` on a never-started adapter is a no-op.
  - Re-using an adapter after `stop` allows another `start`.

No integration tests are required for this ticket — there is no subprocess, network, or filesystem behavior to integrate. Real adapters in follow-up tickets will add integration coverage.

## Acceptance Criteria Mapping

| Issue criterion | Where it's satisfied |
|---|---|
| No agent-specific logic in the workflow engine | Interface and reference adapter live under `src/agents/`; spec adds a forward-looking constraint enforced by review until the engine exists. |
| Interface covers start, stop, send, status | `AgentAdapter` declares all four methods with full contracts (preconditions, transitions, errors). |
| At least one adapter validates the interface | `ScriptedAgentAdapter` implements every method, is exercised by unit tests, and is fit-for-purpose as a future engine test double. |

## Risks & Open Questions

- **Real-adapter shape may force changes.** When the Claude Code / Codex / Pi adapters land, the `AgentResponse` shape (currently `{ output: string }`) may need richer fields (exit status, tool calls, structured events). That is acceptable — the v1 interface is intentionally minimal and we will iterate. The spec for each follow-up ticket should re-evaluate the contract.
- **Streaming is deferred.** Real agents stream output. If the engine ever needs incremental responses before the full result, we will add an `AsyncIterable`-returning method (e.g. `sendStream`) alongside `send`, not replace it.
- **No event/observability hooks.** Status is poll-only. If the engine needs to react to agent state changes, we will add an `onStatusChange` subscription in a follow-up. Not yet.

## Recommendation

Ship the interface as described above with `ScriptedAgentAdapter` as the validation implementation. Keep the surface minimal so real adapters can land iteratively without breaking the contract.
