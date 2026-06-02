# Issue #38 — Pi Agent Adapter Design

**Parent:** [#8 — Epic: Agent Adapter Architecture](https://github.com/robert-gleis/issueflow/issues/8)  
**Depends on:** [#33 — Agent Adapter Interface](https://github.com/robert-gleis/issueflow/issues/33) (merged in this worktree)  
**Status:** Draft, awaiting user review

## Summary

Ship `PiAgentAdapter`, a concrete `AgentAdapter` that drives the [Pi coding agent](https://pi.dev/) CLI in **RPC mode** (`pi --mode rpc`). The adapter spawns a long-lived Pi subprocess per session, sends prompts over stdin as JSONL, consumes streamed events on stdout, and exposes accumulated output as log snapshots suitable for the IssueFlow event log (`~/.issueflow/state.db`, table `events` — see ADR-0001).

This ticket does **not** change the workflow engine, add SQLite event-log writers, or implement Claude Code / Codex adapters.

## Goals

- Satisfy issue acceptance criteria: spawn Pi via the adapter, track lifecycle status, capture logs in an event-log-friendly shape.
- Keep the workflow engine agent-agnostic: no imports of `PiAgentAdapter` from `src/workflow/`.
- Make the adapter fully testable without a live Pi install or API keys (injectable process transport).
- Align with Pi's documented RPC protocol (LF-delimited JSONL on stdin/stdout; split on `\n` only).

## Non-Goals

- Interactive TUI driving, tmux supervision, or Runner composition (orthogonal tickets).
- Bundling `@earendil-works/pi-coding-agent` as an npm dependency (subprocess + RPC only in v1).
- Handling Pi extension UI dialogs (`extension_ui_request`) beyond logging and auto-rejecting with `cancelled: true` so headless runs do not hang.
- Streaming partial assistant text through `AgentResponse` (v1 `send` waits for `agent_end` and returns final text via `get_last_assistant_text` RPC).
- Persisting Pi session files beyond what Pi itself writes under `~/.pi/agent/sessions/`.

## Acceptance Criteria Mapping

| Issue criterion | Design |
|-----------------|--------|
| Pi agents can be spawned via the adapter | `start()` spawns `pi --mode rpc` (configurable binary) in `workingDirectory`. |
| Adapter tracks agent status (running, idle, finished, errored) | `status()` maps internal lifecycle to `AgentState`; see mapping table below. |
| Adapter captures logs consumable by the event log | `readLogs()` returns `AgentLogSnapshot` (`stdout`, `stderr`, `combined`, `truncated`) matching the Runner log shape used by ADR-0001 telemetry writers. |

### Status vocabulary

Issue wording uses **idle / running / finished / errored**. The shared `AgentState` union uses **idle / running / stopped / error** (plus `starting` / `stopping` for in-flight operations). Mapping:

| Issue term | `AgentState` |
|------------|--------------|
| idle | `idle` |
| running | `running` (includes `starting` while spawn/RPC handshake runs) |
| finished | `stopped` |
| errored | `error` |

## Architecture

New files under `src/agents/`:

```
src/agents/
  log-snapshot.ts   # AgentLogSnapshot, AgentLogOptions (event-log shape)
  pi-rpc.ts         # JSONL framing, RPC command helpers, event parsing
  pi.ts             # PiAgentAdapter implements AgentAdapter + readLogs()
  index.ts          # re-export PiAgentAdapter (existing barrel extended)
```

```
tests/unit/
  pi-rpc.test.ts
  pi-agent-adapter.test.ts
```

### Layering

1. **`PiRpcTransport`** (in `pi-rpc.ts`, test-only surface exported as `createTestPiRpcTransport` or similar): owns byte buffers, splits stdout on `\n` only, writes stdin lines. No `readline` (Unicode line-separator hazard per Pi docs).
2. **`PiRpcSession`**: wraps transport; implements `prompt`, `getLastAssistantText`, `abort`, `getState`; correlates RPC responses by optional `id`; waits for `agent_end` after `prompt`.
3. **`PiAgentAdapter`**: implements `AgentAdapter`; owns optional `PiRpcSession`; ring-buffers raw stdout/stderr lines into `AgentLogSnapshot`; maps process exit to `error` state.

The workflow engine continues to depend only on `AgentAdapter`. Callers that persist telemetry call `readLogs()` on `PiAgentAdapter` (concrete method, not part of the shared interface — same pattern as future event subscribers reading Runner `logs()`).

### `start` / `send` / `stop` / `status`

**`start(input)`**

- Reject unless state is `idle` or `stopped` (`AgentAdapterError` / `invalid-state`).
- Set `starting`, then spawn:
  - Binary: `options.binary ?? 'pi'`
  - Args: `['--mode', 'rpc', '--offline', '--no-session']` plus optional `initialInstructions` folded into the first `prompt` after spawn (not a separate CLI flag).
  - `cwd`: `input.workingDirectory` (must exist; reject with `start-failed` if not).
  - Env: inherit process env; callers may pass `env` overrides via adapter options.
- On successful spawn, transition to `running` and record `startedAt`.
- On spawn failure, set `error` and throw `start-failed`.

**`send(message)`**

- Reject unless `running`.
- Issue RPC `prompt` with a generated `id`; wait for matching `response` with `success: true`.
- Wait for an `agent_end` event (or `message_end` + non-streaming completion — implementation waits for `agent_end` per protocol).
- Call `get_last_assistant_text`; return `{ output: text ?? '' }`.
- Update `lastActivityAt`. On RPC/transport failure, set `error`, throw `send-failed`.

**`stop()`**

- If `idle` or `stopped`, no-op.
- Best-effort `abort` RPC, then SIGTERM child (SIGKILL after short timeout if still alive).
- Transition to `stopped`.

**`status()`**

- Return snapshot: `state`, `startedAt`, `lastActivityAt`, `error` when set.

**`readLogs(options?)`**

- Return current ring-buffer contents as `AgentLogSnapshot`.
- `sinceByteOffset` in options is reserved (v1 may ignore; documented for event-log tailing follow-up).
- `truncated: true` when an internal max-bytes cap is reached (default 1 MiB combined, configurable in constructor).

### Headless extension UI

When stdout emits `extension_ui_request` with dialog methods (`select`, `confirm`, `input`, `editor`), the adapter auto-writes `extension_ui_response` with `cancelled: true` so Pi does not block waiting for a human. Fire-and-forget UI methods are appended to the log buffer only.

### Engine isolation

> Code under `src/workflow/` must not import `pi.ts` or `pi-rpc.ts`. Only `src/agents/index.ts` may export `PiAgentAdapter` for application wiring and tests.

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A. Long-lived RPC subprocess** | Multi-turn session; matches Pi's integration story; engine can `send` repeatedly | Requires JSONL client; must handle extension UI | **Chosen** |
| B. One-shot `pi -p` per `send` | Simple spawn/wait | No real session; slow; poor for workflow loops | Rejected |
| C. In-process `createAgentSession` SDK | Richest API | Heavy dependency; couples IssueFlow to Pi releases | Deferred |

## Testing

- **`pi-rpc.test.ts`**: JSONL split edge cases (`\n` only, `\r\n` strip); response correlation; `agent_end` detection; extension UI auto-cancel.
- **`pi-agent-adapter.test.ts`**: full `AgentAdapter` lifecycle with a fake transport that replays scripted stdout lines (no real `pi` binary). Covers start/send/stop/status, log buffer growth + truncation flag, invalid-state paths, respawn after stop.

No live-Pi integration test in CI (API keys / network). Optional manual checklist in plan.

## Risks

- **Pi RPC protocol drift** — mitigated by pinning behavior to documented commands (`prompt`, `get_last_assistant_text`, `abort`, `agent_end` events) and failing tests when fixtures change.
- **Extension UI blocking** — mitigated by auto-cancel responses in headless mode.
- **Log volume** — mitigated by ring buffer + `truncated` flag for event-log writers.

## Recommendation

Implement **Approach A** with injectable transport, `readLogs()` for telemetry, and strict JSONL framing per Pi RPC docs. Keep `AgentAdapter` unchanged; validate against the same structural tests as `ScriptedAgentAdapter`.
