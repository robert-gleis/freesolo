# Worktree Metadata Tracking Design

**Issue:** [#28 — Worktree Metadata Tracking](https://github.com/robert-gleis/freesolo/issues/28)
**Parent:** #10 — Epic: Worktree Management
**Status:** Draft, awaiting user review

## Summary

Persist metadata for every FreeSolo-owned worktree in the shared SQLite store at `~/.freesolo/state.db`, so the factory can recover ownership and cleanup decisions after restart. This ticket also delivers the minimal **SQLite State Store** foundation (database file, WAL mode, migration runner) that sibling tickets (#23 Agent Event Log) will extend — but only the `worktrees` table and its API ship here.

## Goals

- Record worktree path, branch, agent owner, issue id, `created_at`, and `last_seen_at` for every worktree FreeSolo creates or reuses.
- Survive process restarts: metadata is the source of truth for ownership and cleanup decisions.
- Detect drift between git worktrees on disk and persisted metadata (both directions).
- Make writes idempotent under concurrent FreeSolo processes (safe upsert, WAL mode).
- Wire `freesolo start` so metadata is upserted automatically when a worktree is created or reused.

## Non-Goals

- Building the `events` table or event-log API (#23).
- Automatic cleanup or pruning of orphaned worktrees — drift detection reports only; remediation is a follow-up.
- Cross-machine sync of `state.db` (ADR-0001: telemetry is host-bound).
- Replacing `.git/freesolo/session.json` — session state remains per-worktree intra-session state.
- Storing `repo_root` as a column — v1 scopes drift checks to a caller-supplied repo root by comparing `git worktree list` output against DB rows whose `path` appears in that list.

## Dependency Resolution

Issue #28 lists two blockers:

| Blocker | Status | Resolution |
|---|---|---|
| #19 Worktree Manager | Closed | `src/core/worktree.ts` and `freesolo start` already manage worktree lifecycle via Worktrunk. |
| SQLite State Store | No ticket | **In scope for this issue:** deliver `src/state/` with DB bootstrap and a versioned migration runner. Migration `001_worktrees` creates the `worktrees` table. Future tickets add tables via new migrations without reworking the foundation. |

## Considered Options

### A. Bundle SQLite foundation + worktrees table (recommended)

Add `better-sqlite3`, open `~/.freesolo/state.db` with WAL, run numbered SQL migrations, expose a `WorktreeStore`. Hook into `freesolo start`.

**Pros:** Unblocks #23 pattern, matches ADR-0001, single cohesive PR.
**Cons:** Slightly broader than the issue title; mitigated by keeping `events` out of scope.

### B. JSON files under `~/.freesolo/worktrees/`

**Rejected:** Contradicts ADR-0001 and the issue's explicit SQLite requirement; poor concurrency story.

### C. Wait for a separate SQLite State Store ticket

**Rejected:** No ticket exists; #23 is also blocked. Shipping the foundation here is the pragmatic unblock.

## Architecture

```
src/state/
  paths.ts          # resolveStateDbPath() → ~/.freesolo/state.db
  db.ts             # openStateDb(), WAL + busy_timeout pragmas
  migrations.ts     # schema_migrations table, runMigrations()
  migrations/
    001_worktrees.sql
  worktrees.ts      # WorktreeRecord, WorktreeStore (upsert, get, list, delete, touch)
  drift.ts          # detectWorktreeDrift(repoRoot, gitEntries, dbRows)
  index.ts          # barrel

src/commands/worktrees.ts   # freesolo worktrees list | drift
```

`WorktreeStore` receives an already-open `Database` instance (dependency injection for tests). Production code opens the DB once per CLI invocation or `start` action.

### Schema

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worktrees (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  branch TEXT NOT NULL,
  agent_owner TEXT,
  issue_id INTEGER,
  created_at TEXT NOT NULL,    -- ISO-8601 UTC
  last_seen_at TEXT NOT NULL   -- ISO-8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_worktrees_issue_id ON worktrees(issue_id);
CREATE INDEX IF NOT EXISTS idx_worktrees_branch ON worktrees(branch);
```

### Record shape

```ts
interface WorktreeRecord {
  id: number;
  path: string;           // absolute, normalized
  branch: string;
  agentOwner: string | null;
  issueId: number | null;
  createdAt: string;      // ISO-8601
  lastSeenAt: string;     // ISO-8601
}

interface UpsertWorktreeInput {
  path: string;
  branch: string;
  agentOwner?: string | null;
  issueId?: number | null;
  now?: string;           // injectable for tests
}
```

### Store operations

| Method | Behaviour |
|---|---|
| `upsert(input)` | `INSERT … ON CONFLICT(path) DO UPDATE` updating `branch`, `agent_owner`, `issue_id`, `last_seen_at`. Preserves original `created_at` on conflict. Returns the row. |
| `getByPath(path)` | Single row or `null`. |
| `list()` | All rows ordered by `last_seen_at` descending. |
| `deleteByPath(path)` | Remove row; no-op if missing. Returns whether a row was deleted. |
| `touch(path, now?)` | Update `last_seen_at` only; throws `WorktreeNotFoundError` if path absent. |

Path normalization: `path.resolve()` before read/write so the same worktree always maps to one key.

### Idempotency and concurrency

- `better-sqlite3` with `PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000`.
- `upsert` is a single statement — safe to call from concurrent `freesolo start` processes.
- Repeated `upsert` with the same path updates `last_seen_at` and mutable fields without duplicating rows.
- `runMigrations()` uses a transaction and records applied versions — safe if two processes migrate on first open (SQLite serializes writers; second run sees migrations already applied).

### Drift detection

```ts
interface WorktreeDriftReport {
  onDiskOnly: Array<{ path: string; branch: string }>;   // git worktree, no DB row
  metadataOnly: WorktreeRecord[];                         // DB row, path not in git list
}

function detectWorktreeDrift(
  gitEntries: WorktreeEntry[],
  dbRows: WorktreeRecord[]
): WorktreeDriftReport;
```

`freesolo worktrees drift` resolves the repo root (same helper as other commands), calls `listWorktreeEntries(repoRoot)`, loads all DB rows whose `path` is in the git entry path set **or** whose `path` is missing from disk, and returns the diff. Rows in DB for paths outside the current repo's worktree list are included in `metadataOnly` when the path no longer exists on disk (`fs.access`).

Scope note: because there is no `repo_root` column, `list` is global across all repos on the host. Drift for a repo compares only paths returned by `git worktree list` for that repo's main checkout plus DB rows at those paths; DB rows for deleted paths anywhere are surfaced in `metadataOnly`.

## CLI Surface

New command group:

```
freesolo worktrees list [--json]
freesolo worktrees drift [--json]
```

- `list`: print all persisted worktrees (table to stdout, or JSON with `--json`).
- `drift`: resolve repo root from cwd, run drift detection, print human-readable report or JSON. Exit `0` when no drift, `1` when drift found, `2` on operational error.

No `sync` command in v1 — `freesolo start` is the write path. A future ticket can add bulk reconciliation.

## Integration: `freesolo start`

After `worktreePath` is resolved and before writing `session.json`, call:

```ts
worktreeStore.upsert({
  path: worktreePath,
  branch: branchName,
  agentOwner: input.tool,
  issueId: issue.number
});
```

Failure to persist metadata is **fatal** for `start` — the user sees a clear error and the host is not launched. Metadata is part of the factory contract.

`--print-only` does not write metadata (no worktree side effects).

## Error Types

- `StateDbError` — cannot open or migrate the database (permissions, corrupt file).
- `WorktreeNotFoundError` — `touch` or `delete` target missing.

## Testing Strategy

- Unit tests with `:memory:` SQLite databases (inject `Database` into `WorktreeStore`).
- Migration tests: fresh DB applies `001`, re-run is no-op.
- Drift tests: pure function with fixture git entries and DB rows.
- Integration test: temp `FREESOLO_STATE_DIR` env override pointing at a temp directory (see paths module) so tests never touch `~/.freesolo`.
- `start` integration: mock `WorktreeStore.upsert` via deps injection to assert it is called with expected fields.

### Test-only path override

`resolveStateDbPath()` checks `process.env.FREESOLO_STATE_DIR` first (absolute directory containing `state.db`). Production default remains `~/.freesolo/state.db`. Documented in code comment only — not exposed as CLI flag.

## Acceptance Criteria Mapping

| Criterion | How |
|---|---|
| Metadata survives restart | SQLite file at `~/.freesolo/state.db`; tests round-trip upsert → reopen → read. |
| Metadata is source of truth for ownership | Documented; `list` and store API exposed; `start` writes on every attach/create. |
| Drift detection (both directions) | `detectWorktreeDrift` + `freesolo worktrees drift`. |
| Idempotent under concurrent processes | WAL + `ON CONFLICT` upsert; migration idempotency tested. |

## Related

- [ADR-0001](../../adr/0001-state-persistence-split.md) — persistence split rationale.
- #23 Agent Event Log — will add `events` table via migration `002_events` (future).
- `src/core/worktree.ts` — git worktree enumeration for drift.
