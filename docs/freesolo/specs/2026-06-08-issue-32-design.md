# Issue #32 — Session Replay Design

**Issue:** [#32 — Session Replay](https://github.com/robert-gleis/freesolo/issues/32)
**Parent:** #15 — Epic: Observability
**Builds on:** #23 (Agent Event Log, merged)
**Status:** Draft, awaiting user review

## Summary

Add a `src/replay/` module that reconstructs a completed workflow execution from persisted telemetry: workflow-engine decisions and transitions in the Event Log, agent lifecycle events, and captured agent log snapshots in a new SQLite table. Ship persistence helpers wired at the composition root (CLI/commands), a `buildWorkflowReplay` assembler, text/JSON formatters, and `freesolo replay show` for offline inspection without a live agent session.

ADR-0001 applies: high-frequency telemetry stays in `~/.freesolo/state.db`. Replay is a read path over data already on disk.

## Goals

- Reconstruct an end-to-end chronological narrative for one issue from persisted events and log snapshots.
- Surface which agents were spawned, engine decisions (wait/transition/spawn/refuse), state transitions, and agent stdout/stderr captured at stop time.
- Work when no agent process or FreeSolo session is still running.
- Extend the Event Log with workflow-engine event types without coupling `src/workflow/` to SQLite.
- Expose `freesolo replay show --issue <n>` for human and scripted inspection.

## Non-Goals

- **Workflow Timeline UI (#31).** Timeline is a lighter, transition-focused view; replay owns the richer inspection model. #31 may reuse the same event types later.
- **Live streaming or websocket replay.** Offline assembly only.
- **Re-executing agents from replay data.** Inspection, not simulation.
- **Cross-machine replay.** Host-bound store per ADR-0001.
- **Persisting logs on every `send()`.** v1 captures a snapshot when `captureAgentLog` is called (typically on agent stop); periodic capture is a follow-up.
- **Wiring every factory emitter.** v1 ships replay store, event-type extensions, persistence helpers, builder, and CLI. Callers opt in at composition time; full factory wiring can land incrementally.

## Considered Options

### A. Event Log + dedicated `agent_log_snapshots` table (recommended)

Extend `EVENT_TYPES` with `workflow.decision`, `workflow.transition`, and `agent.log.captured`. Store large stdout/stderr in migration version 4 table `agent_log_snapshots`; events carry `snapshotId` in payload. `buildWorkflowReplay` joins events to snapshots.

**Pros:** Keeps event rows small; indexed lookups; matches ADR-0001; mirrors event-log / worktree-metadata split.
**Cons:** Two tables to query (acceptable for v1 scope).

### B. Inline log payloads on events

Store stdout/stderr directly in `payload_json` on `agent.stopped`.

**Rejected:** Multi-KB payloads bloat the events table and complicate query limits.

### C. File-based replay bundles under `~/.freesolo/replays/`

**Rejected:** ADR-0001 places telemetry in SQLite; a second substrate adds sync and backup complexity.

## Architecture

```
src/replay/
  types.ts           # ReplayStep unions, WorkflowReplay, ReplayError
  log-store.ts       # openAgentLogStore, capture/read snapshots (migration v4)
  migration.ts       # agent_log_snapshots table
  persistence.ts     # persistWorkflowEngineEvents, captureAgentLogSnapshot
  builder.ts         # buildWorkflowReplay(issueId)
  format.ts          # formatReplayText, formatReplayJson
  index.ts           # barrel

src/event-log/types.ts   # extend EVENT_TYPES (workflow.*, agent.log.captured)
src/event-log/store.ts   # add order?: 'asc' | 'desc' to EventQuery

src/commands/replay.ts   # registerReplayCommands — show subcommand
src/cli.ts               # register replay commands

tests/unit/replay-*.test.ts
tests/unit/replay-engine-isolation.test.ts
```

Changes outside `src/replay/`:

```
src/state-store/migrations/index.ts   # append AGENT_LOG_SNAPSHOTS_MIGRATION
src/event-log/types.ts                # new event types
src/event-log/store.ts                # ascending list order
```

### Dependency on #23

Event Log API and `events` table (migration v2) are merged. This ticket adds migration v4 (`agent_log_snapshots`) and three event types. `src/workflow/` gains **no** compile-time dependency on replay or event-log.

### Event types (extensions)

| Event type | Typical fields | Payload (schema v1) |
|---|---|---|
| `workflow.decision` | `issue_id`, `workflow_id` | `{ fromState, action: { kind, … } }` |
| `workflow.transition` | `issue_id`, `workflow_id` | `{ from, to }` |
| `agent.log.captured` | `agent_id`, `issue_id`, `workflow_id` | `{ snapshotId, truncated, stdoutBytes, stderrBytes }` |

Existing `agent.created` / `agent.stopped` remain the lifecycle bookends.

### Schema (migration version 4)

```sql
CREATE TABLE agent_log_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  issue_id INTEGER,
  workflow_id TEXT,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  truncated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_agent_log_snapshots_issue_id ON agent_log_snapshots (issue_id);
CREATE INDEX idx_agent_log_snapshots_agent_id ON agent_log_snapshots (agent_id);
```

### Public API

```ts
// src/replay/types.ts
export type ReplayStep =
  | { kind: 'workflow.decision'; at: string; fromState: string | null; action: Record<string, unknown> }
  | { kind: 'workflow.transition'; at: string; from: string; to: string }
  | { kind: 'agent.lifecycle'; at: string; eventType: 'agent.created' | 'agent.stopped'; agentId: string; payload: Record<string, unknown> }
  | { kind: 'agent.log'; at: string; agentId: string; stdout: string; stderr: string; truncated: boolean };

export interface WorkflowReplay {
  issueId: number;
  workflowId: string | null;
  steps: ReplayStep[];
  startedAt: string | null;
  endedAt: string | null;
}

// src/replay/builder.ts
export function buildWorkflowReplay(input: {
  issueId: number;
  eventLog?: EventLog;
  logStore?: AgentLogStore;
}): WorkflowReplay;

// src/replay/persistence.ts
export function persistWorkflowEngineEvents(
  engine: WorkflowEngine,
  context: { issueId: number; workflowId?: string; eventLog: EventLog }
): () => void;

export function captureAgentLogSnapshot(input: {
  agentId: string;
  issueId: number;
  workflowId?: string;
  snapshot: AgentLogSnapshot;
  eventLog: EventLog;
  logStore: AgentLogStore;
}): void;

// src/replay/format.ts
export function formatReplayText(replay: WorkflowReplay): string;
export function formatReplayJson(replay: WorkflowReplay): string;
```

`buildWorkflowReplay` lists events for `issueId` in ascending `id` order, maps known types to `ReplayStep`, and hydrates `agent.log.captured` payloads from `agent_log_snapshots`. Unknown event types are skipped (forward-compatible).

`persistWorkflowEngineEvents` subscribes to `engine.on` and appends `workflow.decision` / `workflow.transition` rows. Unsubscribe function returned for tests.

`captureAgentLogSnapshot` inserts the snapshot row, then appends `agent.log.captured` with `snapshotId`.

### CLI

```
freesolo replay show --issue <n> [--format text|json] [--db <path>]
```

- Default `--format text`: human-readable timeline with timestamps, decisions, transitions, agent blocks.
- `--format json`: `WorkflowReplay` JSON for tooling.
- Exit `0` on success, `2` when no events exist for the issue, `1` on store errors.
- `--db` overrides state DB path (tests and multi-env).

### Error handling

`ReplayError` with codes: `no-events`, `store-error`, `closed`. SQLite failures wrap as `store-error`. Empty event list returns `ReplayError('no-events', …)` from builder; CLI maps to exit 2.

## Testing

| Test file | Covers |
|---|---|
| `replay-log-store.test.ts` | Migration v4, capture/read round-trip, truncated flag |
| `replay-persistence.test.ts` | Engine subscriber writes decision/transition events |
| `replay-builder.test.ts` | Chronological assembly, log hydration, unknown-type skip |
| `replay-format.test.ts` | Text and JSON output shape |
| `replay-command.test.ts` | CLI exit codes, format flag |
| `replay-engine-isolation.test.ts` | No `src/workflow/**/*.ts` imports from `src/replay/` |
| `event-log-query.test.ts` (extend) | Ascending order option |

Use injectable `path` on stores and in-memory / temp DB per existing event-log test convention.

## Acceptance criteria mapping

| Criterion | How verified |
|---|---|
| Completed workflow execution inspectable end-to-end | `buildWorkflowReplay` returns ordered `ReplayStep[]` spanning decisions, transitions, lifecycle, logs |
| Agent decisions and outputs viewable | `workflow.decision` steps + `agent.log` steps with stdout/stderr |
| Replay works against persisted data without live session | Builder reads only SQLite; CLI `show` needs no running agent |

## Related

- ADR-0001 — persistence split
- #23 — Agent Event Log (prerequisite)
- #31 — Workflow Timeline (sibling reader; not implemented here)
- #24 — Workflow Engine (subscriber target, not modified)

## Recommendation

Option A: dedicated log snapshot table, extended event types, composition-root persistence helpers, and a thin CLI. Matches established module boundaries (#23, #28, #35) and satisfies all acceptance criteria without over-building timeline UI.
