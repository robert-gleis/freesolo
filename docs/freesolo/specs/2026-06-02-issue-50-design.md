# Issue #50 — Cursor Agent Adapter Design

**Issue:** [#50 — Implement Cursor Adapter](https://github.com/robert-gleis/freesolo/issues/50)  
**Parent:** [#8 — Epic: Agent Adapter Architecture](https://github.com/robert-gleis/freesolo/issues/8)  
**Depends on:** [#33 — Create Agent Adapter Interface](https://github.com/robert-gleis/freesolo/issues/33) (closed)  
**Status:** Draft, awaiting user review

## Summary

Add `CursorAgentAdapter`, a concrete `AgentAdapter` implementation that drives Cursor Agent sessions headlessly via the installed `cursor-agent` CLI. The adapter gives the workflow engine (#24) the same lifecycle surface (`start` / `stop` / `send` / `status`) as future Pi, Claude Code, and Codex adapters, while preserving today's `freesolo start --tool cursor` launch-plan behaviour.

## Goals

- Implement `AgentAdapter` for Cursor using the same state machine and `AgentStatus` shape as `ScriptedAgentAdapter` (#33).
- Reuse the existing launch contract (`cursor-agent --workspace <worktree> <prompt>`) for the CLI handoff path — no regression in `buildCursorLaunchPlan`.
- Make the adapter testable without network: inject a `runCursorAgent` function that unit tests stub.
- Export the adapter from `src/agents/index.ts` for callers outside `src/workflow/`.

## Non-Goals

- Pi, Claude Code, or Codex adapters (separate tickets #38–#40).
- Wiring `CursorAgentAdapter` into `freesolo start` or the workflow engine in this ticket — callers pass the adapter when configuring the engine.
- `@cursor/sdk` dependency — the CLI is already required for `freesolo start --tool cursor` and matches the passive launch plan.
- Streaming `send` responses, MCP configuration, or sandbox policy beyond `--trust` for headless runs.
- Replacing or removing `src/adapters/cursor.ts`; it remains the `LaunchPlanBuilder` for one-shot CLI launch.

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **`cursor-agent` CLI (recommended)** | No new deps; matches `buildCursorLaunchPlan`; `--print --output-format json` returns `session_id` + `result`; testable via injected runner | Subprocess per `send`; must parse JSON stderr/stdout | **Ship this** |
| **`@cursor/sdk`** | Clean programmatic API | New dependency; version drift vs installed CLI; heavier for a thin adapter ticket | Defer to a follow-up if CLI limits bite |
| **Long-lived interactive subprocess** | Theoretical lower latency | Hard to drive TUI protocol; brittle in CI | Reject |

## Architecture

New file under the existing agents module:

```
src/agents/
  cursor.ts       # CursorAgentAdapter + CursorAgentDeps
  index.ts        # re-export CursorAgentAdapter
```

`src/adapters/cursor.ts` is **unchanged** — it continues to build the declarative `LaunchPlan` used by `freesolo start`.

### Session model

Cursor headless invocations are one-shot per call with conversation continuity via `session_id`:

1. **`start(input)`** — transitions `idle|stopped` → `starting` → `running`. Records `startedAt`. Clears `lastActivityAt` (parity with `ScriptedAgentAdapter`). Always calls `cursor-agent create-chat` to obtain a `session_id` and stores `workingDirectory`. Does **not** run model work and **ignores** `initialInstructions` on `start` — matching `ScriptedAgentAdapter`, which also ignores that field. The workflow engine's `spawn` path calls `start({ initialInstructions })` then immediately `send(initialInstructions)`; the first prompt is delivered only via `send`.
2. **`send(input)`** — requires `running` and a stored `session_id`. Runs `cursor-agent --resume <session_id> --print --trust --output-format json --workspace <cwd> <input>`, parses JSON, updates `lastActivityAt`, returns `{ output: result }`.
3. **`stop()`** — briefly enters `stopping`, clears `session_id`, sets `stopped`. No-op from `idle`/`stopped`.
4. **`status()`** — snapshot of internal state plus timestamps/error.

On CLI failure (non-zero exit, unparseable JSON, missing `result` field), transition to `error` with `AgentAdapterError` (`start-failed` / `send-failed` as appropriate).

### CLI invocation contract

Shared flags for headless (`--print`) invocations:

- `--print` — non-interactive, scriptable
- `--trust` — skip workspace trust prompt (required for automation)
- `--output-format json` — structured result
- `--workspace <workingDirectory>` — from `AgentStartInput.workingDirectory`

`create-chat` is invoked as `cursor-agent create-chat` with process `cwd` set to `workingDirectory` (no `--print`, no `--workspace` flag).

`binary` defaults to `cursor-agent` (overridable in deps for tests).

### Dependency injection

```ts
export interface CursorAgentRunResult {
  sessionId: string;
  output: string;
}

export interface CursorAgentRunOptions {
  cwd?: string;
}

export interface CursorAgentDeps {
  binary?: string;
  run: (args: string[], options?: CursorAgentRunOptions) => Promise<CursorAgentRunResult>;
}

export class CursorAgentAdapter implements AgentAdapter {
  constructor(deps?: CursorAgentDeps);
}
```

When `deps` is omitted, the constructor uses `createDefaultCursorAgentDeps()` (production `execa` wrapper). Production `run` parses the last JSON line on stdout for `--print` invocations and maps `session_id` + `result` fields; for `create-chat`, maps plain stdout to `sessionId`. Tests inject a fake `run` — no subprocess, no API key.

### Engine integration

No changes to `src/workflow/engine.ts`. When a future caller configures:

```ts
createWorkflowEngine({ agent: createCursorAgentAdapter(), ... })
```

the existing `spawn` path works unchanged:

```ts
await agent.start({ workingDirectory, initialInstructions });
await agent.send(initialInstructions);
```

`CursorAgentAdapter.start` ignores `initialInstructions` (same as `ScriptedAgentAdapter`); only `send` runs the headless CLI with the prompt. This avoids double subprocess invocation on spawn.

Event log integration is satisfied by the engine's existing `on()` subscriber — this adapter does not emit events itself.

## Status Surface Parity

`AgentStatus` uses the same fields as `ScriptedAgentAdapter`:

| Field | Cursor behaviour |
|-------|------------------|
| `state` | Full `AgentState` union; uses `starting`/`stopping` briefly around async CLI calls |
| `startedAt` | Set when `start` succeeds |
| `lastActivityAt` | Updated on each successful `send`; cleared on `start` |
| `error` | Set when entering `error` state |

## Testing

- `tests/unit/cursor-agent-adapter.test.ts` — full lifecycle via injected `run`:
  - idle → start → running; `startedAt` set
  - start with `initialInstructions` still calls `create-chat` only (does not invoke `--print`)
  - send returns parsed output; updates `lastActivityAt`
  - send before start → `invalid-state`
  - double start → `invalid-state`
  - stop from running → `stopped`; stop when idle is no-op
  - CLI failure on start/send → `error` + typed error code
  - restart after stop allowed; `lastActivityAt` cleared on restart
- `tests/unit/cursor-agent-json.test.ts` — parser helper for JSON line extraction (including missing `session_id`)

Existing `tests/unit/adapters.test.ts` for `buildCursorLaunchPlan` must remain green unchanged.

## Acceptance Criteria Mapping

| Criterion | How satisfied |
|-----------|---------------|
| Launch, stop, send, status through `AgentAdapter` | `CursorAgentAdapter` implements all four methods with #33 contracts |
| Integrates with FreeSolo workflow | Engine `spawn` path works when adapter is injected; no engine changes required |
| Same status surface as other adapters | Uses shared `AgentStatus` / `AgentState` types; same fields as reference adapter |
| No regressions in Cursor-driven flows | `buildCursorLaunchPlan` untouched; `freesolo start --tool cursor` launch plan identical |

## Risks

- **CLI output shape changes** — Parser keys off `session_id` and `result` from observed `cursor-agent` JSON. A breaking CLI change would require adapter update; mitigate with parser unit tests using fixture stdout.
- **Auth / environment** — Headless runs require `cursor-agent` login or `CURSOR_API_KEY` on the host; out of scope for this ticket (same as today).
- **Latency** — Each `send` is a full agent invocation; acceptable for workflow-engine ticks.

## Recommendation

Ship `CursorAgentAdapter` as a thin, injectable CLI wrapper in `src/agents/cursor.ts`. Keep `src/adapters/cursor.ts` as the launch-plan builder. Defer `@cursor/sdk` until a ticket needs features the CLI cannot expose.
