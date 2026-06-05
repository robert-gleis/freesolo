# Issue #36 — GitHub Issue Watcher Design

**Issue:** [#36 — GitHub Issue Watcher](https://github.com/robert-gleis/issueflow/issues/36)
**Parent:** #16 — Epic: Autonomous Execution
**Builds on:** #24 (Workflow Engine, merged), #17 (Workflow State Machine, merged)
**Status:** Draft, awaiting user review

## Summary

Add a local polling watcher that detects GitHub issues carrying a configured trigger label (default `state:triaged`) and enqueues them for the workflow engine. The watcher runs inside the IssueFlow CLI — no webhooks, no public endpoint. A per-repo cursor in SQLite (`~/.issueflow/state.db`) records the last processed `updatedAt` timestamp so restarts do not re-queue issues. Configuration lives in `~/.issueflow/config.yaml`.

Because the standalone "SQLite State Store" ticket does not yet exist, this issue ships the **minimal shared DB bootstrap** (open-or-create `state.db`, WAL mode, schema version table, migrations runner) plus the watcher-specific tables. Future tickets (#23 Event Log, #28 Worktree Metadata) extend the same file.

## Goals

- Detect newly triaged issues within one configurable polling interval (default 60 seconds).
- Enqueue detected issues for autonomous execution by calling the existing workflow engine (`createWorkflowEngine().tick()`).
- Persist a per-repo cursor so detection survives process restarts without duplicate queuing.
- Make polling interval and trigger label configurable via `~/.issueflow/config.yaml`.
- Back off polling when `gh` returns HTTP 403 or 429 (rate limit).
- Ship as `issueflow watch` with `run` (blocking loop) and `once` (single poll, for tests and cron).

## Non-Goals

- Webhook receiver or any network-facing endpoint.
- Multi-repo fan-out in v1 — the watcher operates on the repo resolved from the current checkout's `origin` remote (same as `issueflow engine tick`).
- Full Event Log (#23) or Worktree Metadata (#28) tables — only the shared DB shell and watcher tables land here.
- Spawning agent sessions (`issueflow start`) from the watcher — v1 enqueues by engine tick only. The engine's policy decides the next action.
- Cross-machine cursor sharing — SQLite is host-bound per ADR-0001.

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Inline poll loop + immediate engine tick** | Simplest; no queue table; few moving parts | Crash between tick and cursor advance can double-tick; no audit trail | Rejected — duplicate engine ticks are confusing |
| **B. Poll loop + SQLite queue + drain** | Idempotent enqueue; clear audit; crash-safe with transactions | Slightly more code | **Chosen** |
| **C. External cron calling `watch once`** | No long-running process | Requires user cron setup; misses "within one interval" without external scheduler | Rejected as primary; `once` subcommand kept for testing |

## Architecture

```
src/
  config/
    load.ts              # read ~/.issueflow/config.yaml (minimal YAML subset)
    types.ts             # WatcherConfig, IssueflowConfig
  state/
    db.ts                # openStateDb(), migrate(), schema version
    migrations/
      001-watcher.ts     # watcher_cursor + watcher_queue tables
    watcher-store.ts     # cursor read/write, enqueue, dequeue, mark done
  watcher/
    poll.ts              # gh issue list search, label filter, backoff
    runner.ts            # orchestrate poll → enqueue → drain → cursor advance
  commands/
    watch.ts             # issueflow watch run | once
```

Data flow per poll cycle:

```
┌─────────────┐    gh issue list     ┌──────────────┐
│  poll.ts    │ ──────────────────►  │ GitHub issues │
│ (since cursor)                    │ w/ trigger lbl│
└──────┬──────┘                      └──────────────┘
       │ new issues
       ▼
┌─────────────┐   INSERT OR IGNORE   ┌──────────────────┐
│ runner.ts   │ ──────────────────►  │ watcher_queue    │
└──────┬──────┘                      │ (SQLite)         │
       │ drain pending               └──────────────────┘
       ▼
┌─────────────┐   ISSUEFLOW_ENGINE=1 ┌──────────────────┐
│ engine.tick │ ◄──────────────────  │ workflow engine  │
└──────┬──────┘                      └──────────────────┘
       │ on success
       ▼
┌─────────────┐
│ advance     │  last_seen_updated_at = max(processed.updatedAt)
│ cursor      │
└─────────────┘
```

## Configuration

```yaml
# ~/.issueflow/config.yaml
watcher:
  interval_seconds: 60
  trigger_label: "state:triaged"
```

Defaults apply when the file is missing or keys are absent. `interval_seconds` must be a positive integer (minimum 5 in validation to prevent accidental tight loops). `trigger_label` is used both in the `gh` search query and as a post-fetch label filter (defence in depth).

Config path override: `ISSUEFLOW_CONFIG` env var, defaulting to `~/.issueflow/config.yaml`.

## SQLite Schema (migration 001)

Database path: `~/.issueflow/state.db` (override via `ISSUEFLOW_STATE_DB`).

```sql
-- schema_migrations (shared infrastructure)
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

-- Per-repo polling cursor
CREATE TABLE IF NOT EXISTS watcher_cursor (
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  last_seen_updated_at TEXT NOT NULL,  -- ISO-8601 UTC
  PRIMARY KEY (repo_owner, repo_name)
);

-- Idempotent work queue
CREATE TABLE IF NOT EXISTS watcher_queue (
  id INTEGER PRIMARY KEY,
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_updated_at TEXT NOT NULL,      -- ISO-8601 UTC from GitHub
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  enqueued_at TEXT NOT NULL,
  processed_at TEXT,
  last_error TEXT,
  UNIQUE (repo_owner, repo_name, issue_number, issue_updated_at)
);
CREATE INDEX IF NOT EXISTS idx_watcher_queue_pending
  ON watcher_queue (repo_owner, repo_name, status, enqueued_at);
```

**Cursor semantics:** On first run for a repo, `last_seen_updated_at` defaults to the current UTC time (not epoch zero) so the watcher does not flood-queue every historical triaged issue. Operators who want a backfill run `issueflow watch once --since <ISO>` (CLI flag overrides cursor for that run only).

**Duplicate prevention:** The `UNIQUE` constraint on `(repo_owner, repo_name, issue_number, issue_updated_at)` makes enqueue idempotent. Advancing the cursor to `max(issue_updated_at)` among processed items ensures `updated:>SINCE` search skips already-handled issues on the next poll.

## Polling

Transport:

```bash
gh issue list \
  --repo OWNER/REPO \
  --state open \
  --search "updated:>SINCE label:TRIGGER_LABEL" \
  --json number,updatedAt,labels \
  --limit 100
```

- `SINCE` is the cursor's `last_seen_updated_at` (GitHub accepts ISO-8601 in search).
- `TRIGGER_LABEL` is the configured trigger label. Labels containing `:` are passed as-is (GitHub supports `label:state:triaged`).
- Results are re-filtered in code: issue must still carry the trigger label (search can be approximate).
- Pagination: if 100 results returned, log a warning and process all; next poll's cursor advance prevents re-processing.

**Rate limiting:** On `gh` exit indicating 403/429 (detected via stderr message patterns and non-zero exit), the runner applies exponential backoff starting at 60 seconds, doubling up to 15 minutes, then resumes normal interval. Backoff state is in-memory only (lost on restart — acceptable).

## Engine Integration

Drain loop (per pending queue row):

1. Set `ISSUEFLOW_ENGINE=1` in the subprocess environment (the watch command itself does not require the env var; only engine transitions do).
2. Call `createWorkflowEngine(defaultDeps).tick({ repo, issueNumber })`.
3. On success (no `refused` or acceptable refusal like `no-state` for issues not yet bootstrapped): mark queue row `done`.
4. On hard failure (network, unexpected throw): mark `failed` with `last_error`, do not advance cursor for that item.
5. `no-state` refusal: mark `done` anyway (issue was detected but not yet in workflow — engine correctly refused; re-triage after bootstrap is a future concern).

The watch command does **not** call `issueflow state transition` or write labels directly.

## CLI Surface

```
issueflow watch run [--interval <seconds>] [--trigger-label <label>]
issueflow watch once [--since <iso8601>]
```

- `run`: blocking loop. Reads config, resolves repo from cwd, polls forever until SIGINT/SIGTERM (graceful shutdown finishes current drain).
- `once`: single poll + drain cycle, then exit. `--since` overrides cursor for this run only.
- Both subcommands set `process.exitCode` to 1 if any queue item ends in `failed` during that cycle.

`run` requires `ISSUEFLOW_ENGINE=1` in the environment (same gate as `engine tick`) because draining the queue invokes the engine.

## Modules

### `src/config/load.ts`

- Parse a minimal YAML subset (no new dependency — hand-roll line-based parser for the two keys, or use JSON as fallback). **Decision:** use a tiny hand-rolled parser for `key: value` pairs under `watcher:` — keeps zero new dependencies. If parsing fails, throw with the path in the message.
- Export `loadConfig(path?: string): IssueflowConfig`.

### `src/state/db.ts`

- `openStateDb(path?: string): Database` — creates parent dir, opens SQLite via `node:sqlite` (Node 22+) or `better-sqlite3` if needed. **Decision:** use Node's built-in `node:sqlite` (available in Node 22+). Package.json already requires Node >=20; bump engines to `>=22` or use dynamic import with fallback. **Revised decision:** use `better-sqlite3` is a native dep; prefer **`node:sqlite`** and bump `engines.node` to `>=22.4` (when `node:sqlite` stabilized). Check Node version in CI. Alternatively implement with **sql.js** (WASM, no native). **Final decision:** use `node:sqlite` (built-in, no new dependency) and document Node >=22.4 requirement in engines field.
- `migrate(db)` — runs pending migrations in order.
- WAL mode: `PRAGMA journal_mode=WAL`.

### `src/state/watcher-store.ts`

- `getCursor(repo): string | null`
- `setCursor(repo, isoTimestamp): void`
- `enqueue(repo, issueNumber, issueUpdatedAt): boolean` — returns false if duplicate
- `listPending(repo): WatcherQueueRow[]`
- `markProcessing(id)`, `markDone(id)`, `markFailed(id, error)`

All operations synchronous (better-sqlite3 style) or async wrapper around node:sqlite promises.

### `src/watcher/poll.ts`

- `pollTriagedIssues(input: PollInput): Promise<PollResult>`
- Injectable `runGh` for tests (same pattern as `state-store.ts`).
- Returns `{ issues: TriagedIssue[], rateLimited: boolean }`.

### `src/watcher/runner.ts`

- `runWatchCycle(deps): Promise<WatchCycleResult>` — one poll + enqueue + drain.
- `runWatchLoop(deps): Promise<void>` — interval loop with backoff.

### `src/commands/watch.ts`

- `registerWatchCommands(program)` — wires Commander subcommands.

## Testing

Unit tests (flat `tests/unit/`):

- `config-load.test.ts` — defaults, valid YAML, missing file, invalid values.
- `state-db.test.ts` — migrations apply once, WAL mode, temp db path.
- `watcher-store.test.ts` — cursor, enqueue idempotency, pending list, status transitions.
- `watcher-poll.test.ts` — search query construction, label filter, rate-limit detection (mocked gh).
- `watcher-runner.test.ts` — full cycle with mocked poll + mocked engine tick.
- `watch-command.test.ts` — CLI registration, env gate, exit codes.

No live `gh` or network calls in unit tests.

## Acceptance Criteria Mapping

| Issue criterion | Where satisfied |
|---|---|
| New triaged issues detected within one polling interval | `watch run` loop with configurable `interval_seconds` |
| Work queued automatically into workflow engine | `runner.ts` drain calls `engine.tick()` |
| Restart-resilient cursor, no duplicate queuing | `watcher_cursor` + `watcher_queue` UNIQUE constraint |
| Configurable interval and trigger label | `~/.issueflow/config.yaml` + CLI overrides |
| Respects `gh` rate limits (back off on 403/429) | `poll.ts` detection + `runner.ts` exponential backoff |

## Risks & Open Questions

- **Node SQLite availability.** `node:sqlite` requires Node 22+. If the project must stay on Node 20, swap to `sql.js` in a follow-up. This spec chooses Node 22+ with `node:sqlite`.
- **First-run cursor default.** Starting from "now" means issues triaged before the first `watch run` are not picked up unless the operator passes `--since`. Document clearly.
- **Engine policy is a stub.** `defaultPolicy` returns `wait` for `triaged` — the watcher correctly queues and ticks, but autonomous execution awaits a richer policy ticket. The watcher's job is detection + enqueue, not policy.
- **No-state issues.** Issues with the trigger label but no `state:*` workflow label yet will be tick-refused; we mark them done to avoid infinite retry. A future bootstrap step may auto-initialize state.

## Recommendation

Ship approach B: poll loop with SQLite queue and shared DB bootstrap. Expose `issueflow watch run` and `issueflow watch once`. Keep the watcher thin — poll, enqueue, drain via engine tick, advance cursor.
