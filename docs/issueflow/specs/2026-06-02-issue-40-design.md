# Issue #40 — Codex Agent Adapter Design

**Issue:** [#40 — Implement Codex Adapter](https://github.com/robert-gleis/issueflow/issues/40)  
**Parent:** [#8 — Epic: Agent Adapter Architecture](https://github.com/robert-gleis/issueflow/issues/8)  
**Depends on:** [#33 — Create Agent Adapter Interface](https://github.com/robert-gleis/issueflow/issues/33) (closed)  
**Status:** Approved via issueflow continuation (user review gate)

## Summary

Ship `CodexAgentAdapter`, a production `AgentAdapter` that drives the Codex CLI (`codex exec`) in non-interactive JSONL mode. The adapter captures `thread_id` from `thread.started` events, resumes sessions with `codex exec resume`, maps the final `agent_message` item into `AgentResponse`, and exposes the same `AgentStatus` surface as `ScriptedAgentAdapter` and the Claude/Cursor adapters. The workflow engine (#24) can pass this adapter as `deps.agent` without engine changes.

## Goals

- Launch and drive Codex sessions through `AgentAdapter.start`, `send`, `stop`, and `status`.
- Reuse the #33 contract unchanged — no engine-specific logic inside the adapter.
- Keep subprocess and JSONL parsing behind an injectable `CodexInvoker` so unit tests never call the real CLI.
- Provide one integration test wiring the adapter into `createWorkflowEngine` with a mock invoker (spawn → start → send).

## Non-Goals

- Interactive TUI sessions (`codex` without `exec`), tmux runners, or `codex mcp-server`.
- Streaming partial responses — v1 is single-response `send` only (`--json` consumed to completion).
- Sandbox policy tuning beyond optional constructor flags passed through to the invoker.
- Replacing `src/adapters/codex.ts` (`buildCodexLaunchPlan`) — that module stays for one-shot host launch via `issueflow start --tool codex`.
- Event-log writes inside the adapter — the engine owns workflow telemetry.

## Context

| Layer | Location | Role |
|---|---|---|
| Host launcher | `src/adapters/codex.ts` | `buildCodexLaunchPlan` → `{ binary: 'codex', args: ['-C', worktree, prompt], cwd }` |
| Agent runtime | `src/agents/codex.ts` (new) | Stateful `AgentAdapter` over `codex exec --json` |
| Workflow engine | `src/workflow/engine.ts` | On `spawn`, calls `agent.start` then `agent.send` with `initialInstructions` |

`codex exec --json` emits JSONL on stdout. Key events (see [exec JSON cheatsheet](https://takopi.dev/reference/runners/codex/exec-json-cheatsheet/)):

- `thread.started` → `thread_id` (session continuity)
- `item.completed` with `item.type === "agent_message"` → `item.text` (final answer)
- `turn.failed` / top-level `error` → failure

Resume: `codex exec resume <thread_id> --json -C <cwd> <prompt>`.

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. One-shot `codex exec` per `send`, `exec resume` for continuity** | Matches engine tick model; no long-lived process; symmetric with Claude adapter | Latency per message | **Recommended** |
| B. Long-lived `codex` TUI subprocess | Lower per-message latency | Fragile; hard to test | Rejected |
| C. `codex mcp-server` / app-server JSON-RPC | Rich protocol | Different integration surface; heavier ticket | Defer |

## Architecture

```
src/agents/
  codex.ts         # CodexAgentAdapter + CodexInvoker + JSONL parser
  index.ts         # re-export
tests/unit/
  codex-agent-adapter.test.ts
  codex-exec-json.test.ts
  codex-workflow-integration.test.ts
```

### `CodexInvoker`

Injectable boundary for subprocess I/O:

```ts
export interface CodexInvokeInput {
  cwd: string;
  prompt: string;
  threadId?: string;
}

export interface CodexInvokeResult {
  threadId: string;
  output: string;
}

export type CodexInvoker = (input: CodexInvokeInput) => Promise<CodexInvokeResult>;
```

Default implementation:

- No `threadId`: `codex exec --json -C <cwd> --skip-git-repo-check <prompt>` (git check skipped only when cwd is not a repo — use skip flag when tests use temp dirs).
- With `threadId`: `codex exec resume <threadId> --json -C <cwd> <prompt>`.
- Parse stdout JSONL via `parseCodexExecJsonl(stdout)`.
- Non-zero exit → `AgentAdapterError` `send-failed` with stderr excerpt.
- Missing `thread_id` or final `agent_message` → `send-failed`.

`parseCodexExecJsonl` is a pure exported function tested with fixture stdout.

### `CodexAgentAdapter`

Constructor options:

- `binary?: string` — default `'codex'`
- `invoker?: CodexInvoker` — default uses `binary` via execa

**`start(input)`**

- Preconditions: `idle` or `stopped`; otherwise `invalid-state`.
- Validates `workingDirectory` exists (`fs.access`); failure → `start-failed`.
- Transitions to `running`, records `startedAt`, clears `threadId` and `lastActivityAt`.
- Does **not** invoke Codex (including when `initialInstructions` is set). First prompt is delivered only via `send`, matching Claude/Cursor adapters and the engine spawn path.

**`send(input)`**

- Preconditions: `running`; otherwise `invalid-state`.
- Invokes with stored `threadId` when set; stores returned `threadId`.
- Returns `{ output }` from last `agent_message` text in the stream.
- Updates `lastActivityAt`.
- On failure: transition to `error`, set `error` message, throw `send-failed`.

**`stop()`**

- From `idle`: no-op.
- From `running` / `error`: clears `threadId`, sets `stopped`.
- From `stopped`: no-op.

**`status()`**

- Snapshot of `state`, `startedAt`, `lastActivityAt`, `error`.

### Error mapping

| Situation | Code |
|---|---|
| Wrong lifecycle state | `invalid-state` |
| `start` cannot access working directory | `start-failed` |
| `send` invoke fails or bad JSONL | `send-failed` |
| `stop` never throws on no-op paths | — |

## Workflow integration

Engine spawn path unchanged:

1. `await agent.start({ workingDirectory, initialInstructions })`
2. `await agent.send(initialInstructions)`

No engine changes required.

## Testing

| Test file | Coverage |
|---|---|
| `codex-exec-json.test.ts` | Parser: `thread.started`, `agent_message`, `turn.failed`, empty stdout |
| `codex-agent-adapter.test.ts` | Lifecycle, invoker injection, thread resume, error paths, status timestamps |
| `codex-workflow-integration.test.ts` | `createWorkflowEngine` + mock invoker on `spawn` |

No live CLI tests in CI.

## Acceptance criteria mapping

| Criterion | Satisfaction |
|---|---|
| Codex agents support the same workflow as Pi and Claude Code | `start` + `send` + `stop` + `status` over injectable invoker; engine integration test |
| Adapter status, logs, and lifecycle behave consistently | Same `AgentStatus` fields and state machine semantics as #39/#50 |
| No workflow-engine changes required | Engine imports only `AgentAdapter`; concrete adapter wired by caller |

## Risks

- **JSONL shape drift.** Parser keys off documented `type` / `thread_id` / `item.type` / `item.text`; fixture tests mitigate.
- **Auth / environment.** Headless runs require Codex login on host; out of scope (same as other CLI adapters).
- **Latency.** Each `send` is a full CLI invocation; acceptable for workflow-engine ticks.

## Recommendation

Implement approach A with injectable `CodexInvoker`, pure JSONL parser, flat `tests/unit/` files, and no engine changes.
