# Issue #39 — Claude Code Agent Adapter Design

## Summary

Ship `ClaudeCodeAgentAdapter`, a production `AgentAdapter` implementation that drives the Claude Code CLI (`claude`) in non-interactive print mode. The adapter owns session continuity via Claude's `session_id` / `--resume`, maps subprocess results into `AgentResponse`, and exposes the same `AgentStatus` surface as `ScriptedAgentAdapter`. The workflow engine (#24) can pass this adapter as `deps.agent` without any engine changes.

## Goals

- Launch and drive Claude Code sessions through `AgentAdapter.start`, `send`, `stop`, and `status`.
- Reuse the #33 contract unchanged — no engine-specific logic inside the adapter.
- Keep subprocess and JSON parsing behind an injectable `ClaudeInvoker` so unit tests never call the real CLI.
- Provide one integration-style test that wires the adapter into `createWorkflowEngine` with a mock invoker to prove spawn → start → send works end-to-end.

## Non-Goals

- Interactive / TTY sessions, tmux runners, or Remote Control.
- Streaming (`--output-format stream-json`) — v1 is single-response `send` only.
- Permission-mode tuning, MCP config, or model selection beyond optional constructor overrides.
- Replacing `src/adapters/claude.ts` (`LaunchPlanBuilder`) — that module stays for one-shot host launch; this adapter is the stateful runtime under `src/agents/`.
- Event-log writes inside the adapter — the engine owns workflow telemetry; the adapter only reports its own lifecycle via `status()`.

## Context

| Layer | Location | Role |
|---|---|---|
| Host launcher | `src/adapters/claude.ts` | `buildClaudeLaunchPlan` → `{ binary: 'claude', args: [prompt], cwd }` |
| Agent runtime | `src/agents/claude-code.ts` (new) | Stateful `AgentAdapter` over `claude -p` |
| Workflow engine | `src/workflow/engine.ts` | On `spawn`, calls `agent.start` then `agent.send` with `initialInstructions` |

Claude Code print mode (`claude -p "<prompt>" --output-format json`) returns a JSON object with `result` (text) and `session_id` (for `--resume` on follow-up turns). Verified on the developer machine.

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. One-shot `claude -p` per `send`, `--resume` for continuity** | Simple, no long-lived process, matches engine's tick model | Latency per message; relies on Claude session persistence | **Recommended** |
| B. Long-lived interactive `claude` subprocess with stdin/stdout protocol | Lower per-message latency | Fragile TTY handling, hard to test, out of scope for v1 | Rejected |
| C. HTTP/SDK bypassing CLI | Faster | Breaks adapter symmetry (ADR-0002); separate auth surface | Rejected |

## Architecture

```
src/agents/
  claude-code.ts   # ClaudeCodeAgentAdapter + ClaudeInvoker + JSON types
  index.ts         # re-export
tests/unit/
  claude-code-agent-adapter.test.ts
  claude-code-workflow-integration.test.ts
```

### `ClaudeInvoker`

Injectable boundary for subprocess I/O:

```ts
export interface ClaudeInvokeInput {
  cwd: string;
  prompt: string;
  sessionId?: string;
}

export interface ClaudePrintJson {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
}

export type ClaudeInvoker = (input: ClaudeInvokeInput) => Promise<ClaudePrintJson>;
```

Default implementation runs `claude -p <prompt> --output-format json` with optional `--resume <sessionId>`, `cwd` set to `AgentStartInput.workingDirectory`, and parses stdout as JSON. Non-zero exit or invalid JSON becomes `AgentAdapterError` with `start-failed` or `send-failed`.

### `ClaudeCodeAgentAdapter`

Constructor options:

- `binary?: string` — default `'claude'`
- `invoker?: ClaudeInvoker` — default uses `binary` via execa

**`start(input)`**

- Preconditions: `idle` or `stopped`; otherwise `invalid-state`.
- Transitions to `running`, records `startedAt`, stores `workingDirectory`.
- Does **not** invoke Claude, even when `initialInstructions` is provided. `start` only validates and records runtime state.

**`send(input)`**

- Preconditions: `running`; otherwise `invalid-state`.
- Invokes Claude with stored `sessionId` when set; stores returned `session_id`.
- Returns `{ output: result }` from JSON `result` field; rejects with `send-failed` when `is_error` or `result` is missing.
- Updates `lastActivityAt`.

**`stop()`**

- From `idle`: no-op (state stays `idle`), matching `ScriptedAgentAdapter`.
- From `running` / `error`: clears `sessionId`, sets `stopped`.
- From `stopped`: no-op.

**`status()`**

- Snapshot of `state`, `startedAt`, `lastActivityAt`, `error` (when in `error`).

### Error mapping

| Situation | Code |
|---|---|
| Wrong lifecycle state | `invalid-state` |
| `start` cannot access working directory | `start-failed` |
| `send` invoke fails or bad payload | `send-failed` |
| `stop` never throws on no-op paths | — |

## Workflow integration

The engine's spawn path (`engine.ts` lines 160–178) already:

1. `await deps.agent.start({ workingDirectory, initialInstructions })`
2. `await deps.agent.send(initialInstructions)`

**Chosen:** `start` does **not** auto-send; it only validates `cwd` exists and enters `running`. The engine's explicit `send(initialInstructions)` remains the single first message. This matches current engine behavior and avoids double-prompting without engine changes.

## Testing

| Test file | Coverage |
|---|---|
| `claude-code-agent-adapter.test.ts` | Lifecycle, invoker injection, session resume, error paths, status timestamps |
| `claude-code-workflow-integration.test.ts` | `createWorkflowEngine` + mock adapter invoker on `spawn` action |

No live CLI tests in CI — all invocations go through mock `ClaudeInvoker`.

## Acceptance criteria mapping

| Criterion | Satisfaction |
|---|---|
| Claude Code sessions launched via adapter | `start` + `send` drive `claude -p` through default invoker |
| Integrates with FreeSolo workflow | Integration test: engine `spawn` → adapter start/send; engine emits transition events |
| Same status surface as other adapters | `AgentStatus` fields match `ScriptedAgentAdapter` semantics |

## Risks

- **CLI output shape drift.** Pin parsing to documented fields; tests use fixture JSON.
- **Session resume failures.** Surface as `send-failed` with stderr excerpt in message.
- **Cost/latency.** Each `send` is a full CLI invocation; acceptable for v1 orchestration ticks.

## Recommendation

Implement approach A with injectable `ClaudeInvoker`, flat `tests/unit/` files, and no engine changes.
