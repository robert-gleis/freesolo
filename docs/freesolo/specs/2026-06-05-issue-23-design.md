# Issue #23 — Agent Event Log Design

**Issue:** [#23 — Agent Event Log](https://github.com/robert-gleis/freesolo/issues/23)
**Parent:** #15 — Epic: Observability
**Builds on:** #51 (SQLite State Store, merged prerequisite)
**Status:** Draft, awaiting user review

## Summary

Add a structured, append-only event log backed by the shared SQLite state store at `~/.freesolo/state.db`. The new `src/event-log/` module owns the `events` table schema (migration version 2), typed event names, an `append` API, and indexed query helpers. A small composition helper can subscribe to `WorkflowEngine` in-memory events and persist workflow telemetry without coupling the engine to SQLite.

ADR-0001 is the rationale: high-frequency machine telemetry lives locally; this ticket delivers the Event Log slice of that layout.

## Goals

- Persist observable agent and workflow lifecycle events in one queryable store.
- Enforce append-only writes with ISO-8601 timestamps on every row.
- Version the payload contract via a per-row `schema_version` integer so consumers can evolve.
- Support efficient lookups by `event_type`, `issue_id`, and `agent_id` via indices.
- Validate concurrent append safety on top of the WAL-enabled state store (#51).
- Expose a typed public API that future tickets (#24 wiring, #28, #36, team orchestration) can call without reimplementing SQL.

## Non-Goals

- **Wiring every emitter in the factory.** v1 ships the store, types, migration, and DAO. Instrumenting the workflow engine, agent adapters, verification, team planner, etc. lands in their respective tickets once this API exists.
- **Changing the workflow engine.** `src/workflow/` must not gain a compile-time dependency on `src/event-log/` (same isolation rule as #51). Subscribers are wired at the composition root (`src/commands/` or caller code).
- **Event streaming, pub/sub, or retention policies.** Append and query only; pruning/archival is a future operational ticket.
- **Cross-machine replication.** The store is host-bound per ADR-0001.
- **CLI surface (`freesolo events …`).** Out of scope; consumers call the module directly. A CLI can follow later.

## Architecture

New top-level module `src/event-log/`. Layout:

```
src/event-log/
  types.ts              # EventType union, EventRecord, AppendEventInput, EventQuery, EventLogError
  migration.ts          # Migration version 2 — CREATE TABLE events + indices
  store.ts              # openEventLog(options?) — opens state store, returns EventLog handle
  index.ts              # Barrel re-export
```

Changes outside the module:

```
src/state-store/migrations/index.ts   # append EVENT_LOG_MIGRATION to BASE_MIGRATIONS
tests/unit/event-log-*.test.ts          # unit tests (flat under tests/unit/, repo convention)
tests/fixtures/event-log-concurrent-writer.mjs
```

Why a separate top-level directory:

- Mirrors `src/state-store/`, `src/verification/`, `src/agents/` — one cross-cutting concern per directory.
- Keeps persistence details out of `src/workflow/` so the engine stays GitHub-label-centric.
- Lets #28 (worktrees) and #36 (watcher cursor) add their own tables via the same state-store migration registry without touching event-log internals.

### Dependency on #51

This branch merges `issue/51-sqlite-state-store` before implementation. The event log registers migration version `2` (`events` table) in `src/state-store/migrations/index.ts`. Version `1` remains the no-op init from #51.

## Event types (v1)

Canonical `EventType` values (exact strings, dot-separated):

| Event type | Typical `agent_id` | Typical `issue_id` | Notes |
|---|---|---|---|
| `agent.created` | set | optional | Agent instance started |
| `agent.stopped` | set | optional | Agent instance terminated |
| `issue.assigned` | optional | set | Issue bound to agent/workflow |
| `verification.failed` | optional | set | Verification gate failed |
| `verification.passed` | optional | set | Verification gate passed |
| `team.planned` | optional | set | Autonomous team composition (#45) |
| `plan.approved` | optional | set | Human or autonomous plan approval |
| `decomposition.applied` | optional | set | Issue decomposition applied |

`workflow_id` is an optional opaque string for correlating events across a multi-step workflow run. Callers supply it; the log does not invent one.

Payload bodies are JSON objects stored in `payload_json`. v1 `schema_version` is `1` for all rows. The module exports `CURRENT_EVENT_SCHEMA_VERSION = 1`. When a breaking payload shape ships, bump the constant and document the migration path for readers — old rows keep their stored `schema_version`.

## Schema (migration version 2)

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  agent_id TEXT,
  issue_id INTEGER,
  workflow_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  schema_version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_events_event_type ON events (event_type);
CREATE INDEX idx_events_issue_id ON events (issue_id);
CREATE INDEX idx_events_agent_id ON events (agent_id);
```

Constraints and conventions:

- `created_at` is ISO-8601 UTC with millisecond precision, produced by `new Date().toISOString()` at append time. Callers cannot override it (append-only, server-clock authoritative).
- `payload_json` is always valid JSON. Empty payloads persist as `'{}'`.
- Nullable dimension columns (`agent_id`, `issue_id`, `workflow_id`) are omitted from the INSERT when not provided; SQLite stores `NULL`.
- No `UPDATE` or `DELETE` APIs on `EventLog`. The table is append-only by contract.

## Public API

```ts
// src/event-log/types.ts

export const EVENT_TYPES = [
  'agent.created',
  'agent.stopped',
  'issue.assigned',
  'verification.failed',
  'verification.passed',
  'team.planned',
  'plan.approved',
  'decomposition.applied'
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const CURRENT_EVENT_SCHEMA_VERSION = 1;

export interface EventRecord {
  id: number;
  eventType: EventType;
  agentId: string | null;
  issueId: number | null;
  workflowId: string | null;
  payload: Record<string, unknown>;
  schemaVersion: number;
  createdAt: string;
}

export interface AppendEventInput {
  eventType: EventType;
  agentId?: string;
  issueId?: number;
  workflowId?: string;
  payload?: Record<string, unknown>;
  /** Defaults to CURRENT_EVENT_SCHEMA_VERSION. Override only for forward-compat tests. */
  schemaVersion?: number;
}

export interface EventQuery {
  eventType?: EventType;
  agentId?: string;
  issueId?: number;
  workflowId?: string;
  /** Max rows, default 100. Newest first. */
  limit?: number;
}

export type EventLogErrorCode =
  | 'append-failed'
  | 'query-failed'
  | 'invalid-event-type'
  | 'closed';

export class EventLogError extends Error {
  readonly code: EventLogErrorCode;
  constructor(code: EventLogErrorCode, message: string);
}

export interface EventLog {
  readonly path: string;
  append(input: AppendEventInput): EventRecord;
  list(query?: EventQuery): EventRecord[];
  close(): void;
}

export function openEventLog(options?: { path?: string }): EventLog;
```

### Behaviour notes

- `openEventLog` calls `openStateStore` internally (with optional `path` override for tests), runs migrations (including version 2), and returns an `EventLog` handle that owns the underlying `StateStore` and closes it on `EventLog.close()`.
- `append` validates `eventType` against `EVENT_TYPES` before touching the DB. Unknown types throw `EventLogError('invalid-event-type', …)` without inserting.
- `list` builds a parameterized query from provided filters. Results are ordered `id DESC` (newest first). Default `limit` is `100`; values above `1000` are clamped to `1000`.
## Error handling

- SQLite failures during `append` or `list` wrap as `EventLogError('append-failed' | 'query-failed', cause.message)`.
- Operations after `close()` throw `EventLogError('closed', …)`.
- Invalid `eventType` throws before opening a transaction.

## Testing

| Test file | Covers |
|---|---|
| `tests/unit/event-log-types.test.ts` | `EVENT_TYPES` exhaustiveness, error class, constants |
| `tests/unit/event-log-migration.test.ts` | Migration 2 creates table + indices; idempotent re-open |
| `tests/unit/event-log-append.test.ts` | Append-only, ISO timestamp format, defaults, invalid type rejection |
| `tests/unit/event-log-query.test.ts` | Filter by event_type, issue_id, agent_id; ordering; limit clamp |
| `tests/unit/event-log-concurrency.test.ts` | Fork N processes appending to shared DB; all rows visible; no corruption |

Concurrency test mirrors #51's `state-store-concurrency.test.ts`: child processes call a fixture script that opens the log and appends rows.

## Acceptance criteria mapping

| Criterion | How verified |
|---|---|
| Append-only, ISO-8601 timestamped | `append` never updates; `created_at` matches ISO regex; no public delete API |
| Queryable by agent, issue, event type | Indices in migration; `list` filter tests |
| Schema versioned | `schema_version` column; `CURRENT_EVENT_SCHEMA_VERSION`; per-row value in tests |
| Concurrent append safe (WAL) | `event-log-concurrency.test.ts` with multi-process writers |

## Related

- ADR-0001 — persistence split
- #51 — SQLite State Store (prerequisite)
- #24 — Workflow Engine (future subscriber, not modified here)
- #28 — Worktree Metadata (sibling consumer of state store)
- #31 — Workflow Timeline (likely reader of this log)
