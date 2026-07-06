# Issue #51 — SQLite State Store Design

## Summary

Build the shared, machine-bound SQLite state store at `~/.freesolo/state.db` that hosts the local telemetry tables consumed by the Event Log (#23), Worktree Metadata (#28), and the Issue Watcher cursor (#36). This ticket delivers infrastructure only — connection management, WAL-mode initialisation, a migration runner, and backup / safe-delete helpers — under a new `src/state-store/` module. The concrete tables (`events`, `worktrees`, watcher cursors) ship in the follow-up tickets.

ADR-0001 is the rationale: telemetry lives locally; knowledge lives in the repo.

## Goals

- Provide a single TypeScript module that any FreeSolo code can call to obtain a ready-to-use SQLite connection rooted at `~/.freesolo/state.db`.
- Enable concurrent FreeSolo processes against the same database via WAL mode and a sensible `busy_timeout`.
- Apply pending schema migrations on startup, ordered and idempotent.
- Give consumers a low-friction way to register their own migrations without rewriting this module.
- Provide replaceable-but-not-throwaway lifecycle helpers: a `VACUUM INTO` based backup and a safe-delete that preserves the old file in a trash directory.

## Non-Goals

- No tables for events, worktrees, or watcher cursors. Each consumer ticket owns its own schema migration and DAO.
- No connection pooling. SQLite + WAL gives one writer at a time per process; we expose a single connection per process and let the OS-level lock + `busy_timeout` arbitrate between processes.
- No async query API. `better-sqlite3` is synchronous by design, and the workflow engine is single-event-loop CLI code where synchronous DB calls are simpler and faster.
- No remote backup, no encryption-at-rest, no cross-machine sync. The store is host-bound (per ADR-0001).
- No automatic backup-on-startup or rotation. Backup is an explicit operation.
- No CLI surface (`freesolo state-store …`) in this ticket. Consumers call the module directly.

## Architecture

New top-level module `src/state-store/`. Layout:

```
src/state-store/
  types.ts            # StateStore, StateStoreOptions, Migration, BackupResult, SafeDeleteResult, StateStoreError, StateStoreErrorCode
  paths.ts            # resolveDefaultPath(), resolveTrashDir() — homedir + FREESOLO_HOME override
  connection.ts       # openConnection(path) — applies pragmas, sets WAL, returns better-sqlite3 Database
  migrations.ts       # runMigrations(db, migrations) — schema_migrations table + ordered apply
  backup.ts           # backup(db, target), safeDelete(path) — file-level lifecycle
  store.ts            # openStateStore(options?) — composition root that returns a StateStore handle
  migrations/
    index.ts          # BASE_MIGRATIONS array; consumer tickets append their migrations here
    001-init.ts       # Initial migration: schema_migrations table is created by the runner itself; this file reserves version 1 with a no-op so consumer migrations start at 2
  index.ts            # Barrel re-export of the public surface
```

Why a separate top-level directory:

- Aligns with the existing convention (`src/runners/`, `src/agents/`, `src/verification/`): each cross-cutting concern lives under a flat directory with a barrel `index.ts`.
- Keeps the persistence surface out of `src/workflow/` so the engine has no compile-time dependency on a specific DB technology — only consumers depend on `src/state-store/`.
- Lets future tooling (CLI `freesolo state-store backup` etc., #51 follow-ups) import the same surface without restructuring.

The workflow engine (current `src/workflow/`) does **not** import from `src/state-store/`. Only consumer modules (`src/event-log/`, future `src/worktree-metadata/`, future watcher cursor module) will. A regression test enforces this isolation (mirroring the runner-engine-isolation test from #18).

## Public API

```ts
// src/state-store/types.ts

export type StateStoreErrorCode =
  | 'open-failed'
  | 'migration-failed'
  | 'migration-version-conflict'
  | 'backup-failed'
  | 'safe-delete-failed'
  | 'closed';

export class StateStoreError extends Error {
  readonly code: StateStoreErrorCode;
  constructor(code: StateStoreErrorCode, message: string);
}

export interface Migration {
  /** Monotonically increasing integer. Gaps are allowed; ordering is by `version` ascending. */
  version: number;
  /** Short slug for diagnostics. Does not affect ordering. */
  name: string;
  /** Function that performs the schema change. Called inside a transaction. */
  up: (db: import('better-sqlite3').Database) => void;
}

export interface StateStoreOptions {
  /** Override the database path. Defaults to `<FREESOLO_HOME>/state.db` (typically `~/.freesolo/state.db`). */
  path?: string;
  /** Override the migration list. Defaults to `BASE_MIGRATIONS` from `state-store/migrations/index.ts`. */
  migrations?: Migration[];
}

export interface BackupResult {
  /** Absolute path of the created backup file. */
  path: string;
  /** Bytes on disk. */
  bytes: number;
}

export interface SafeDeleteResult {
  /** Absolute path of the directory the database files were moved to. */
  trashDir: string;
  /** Files that were moved into the trash directory. */
  movedFiles: string[];
}

export interface StateStore {
  /** Absolute path of the open database file. */
  readonly path: string;
  /** Prepare a statement. Pass-through to better-sqlite3. */
  prepare: import('better-sqlite3').Database['prepare'];
  /** Execute one or more SQL statements without returning rows. */
  exec(sql: string): void;
  /** Run `fn` inside a transaction. Auto-commits on return, rolls back on throw. */
  transaction<T>(fn: () => T): T;
  /** Pragma helpers. */
  pragma: import('better-sqlite3').Database['pragma'];
  /** Snapshot the database into `targetPath` (or auto-generated path next to the DB) via VACUUM INTO. */
  backup(targetPath?: string): BackupResult;
  /** Close, then move `state.db` and its WAL/SHM siblings into a timestamped trash directory. */
  safeDelete(): SafeDeleteResult;
  /** Close the database. Idempotent. */
  close(): void;
  /** Escape hatch for advanced consumers that need the raw handle. Use sparingly. */
  readonly unsafe: import('better-sqlite3').Database;
}

export function openStateStore(options?: StateStoreOptions): StateStore;
```

### Behaviour notes

- `openStateStore` is **not** a singleton — calling it twice returns two independent `StateStore` instances over the same file. WAL mode and `busy_timeout` make that safe. The CLI's composition root will hold a single instance; tests freely open and close per case.
- Migrations apply on every `openStateStore` call. The runner reads `schema_migrations` and only applies versions strictly greater than the current max. Idempotent and fast (a single SELECT in the steady state).
- `transaction(fn)` wraps `db.transaction(fn)()` from better-sqlite3. The wrapper exists so consumers don't import better-sqlite3 directly for the common case.
- `prepare` and `pragma` are passed through unchanged — consumers depend on better-sqlite3's well-documented surface for actual query execution. Wrapping these would be a leaky abstraction.

## Connection lifecycle

`openConnection(path: string)` is responsible for:

1. Ensure parent directory exists (`fs.mkdirSync(dir, { recursive: true })`).
2. Open the file via `new Database(path)`.
3. Apply pragmas (in this order):
   - `journal_mode = WAL` — enables concurrent readers + one writer; persisted to the DB file so subsequent opens inherit it.
   - `synchronous = NORMAL` — the WAL-recommended durability level (full fsync on checkpoint, relaxed on regular writes).
   - `foreign_keys = ON` — off by default per SQLite; consumers will rely on it.
   - `busy_timeout = 5000` — five-second wait when another writer holds the lock; covers cross-process contention without spinning.
4. Return the `Database` handle.

`openConnection` throws `StateStoreError('open-failed', …)` with the underlying cause if any step fails. Callers (specifically `openStateStore`) wrap it so the caller sees a typed error, not a raw SQLite exception.

## Migrations

### Schema

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at TEXT    NOT NULL  -- ISO-8601 UTC
);
```

The migration runner creates this table itself before consulting it. Consumer migrations do **not** include the `schema_migrations` DDL.

### Runner

```ts
// pseudocode of runMigrations(db, migrations)
ensureMigrationsTable(db);
const appliedVersions = selectAppliedVersions(db);            // Set<number>
const pending = migrations
  .filter((m) => !appliedVersions.has(m.version))
  .sort((a, b) => a.version - b.version);

assertNoVersionConflict(migrations);                          // unique, integer
assertAppliedKnownToCaller(appliedVersions, migrations);      // every applied row exists in the supplied list

for (const migration of pending) {
  db.transaction(() => {
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(migration.version, migration.name, new Date().toISOString());
  })();
}
```

Failure modes (all throw `StateStoreError`):

- **`migration-version-conflict`** — duplicate `version` in the supplied list.
- **`migration-failed`** — a migration's `up` threw. The transaction rolls back; `schema_migrations` is unchanged. The error message includes the offending version and name.
- **Applied-but-missing-from-list** — the DB has a row for version N, but the supplied `migrations` array does not contain N. This means the caller is running an older binary against a newer database. Surface as `migration-version-conflict` with a message that names the missing versions, so the operator can downgrade the DB (via `safeDelete` + restore from backup) or upgrade the binary.

### Migration files

Each migration is its own TypeScript module under `src/state-store/migrations/`. Naming: `NNN-<slug>.ts` (zero-padded for lexical sort sanity). The module's default export is a `Migration` object. `migrations/index.ts` imports them in order and re-exports a frozen `BASE_MIGRATIONS: readonly Migration[]`.

For this ticket, only `001-init.ts` ships. It is intentionally a no-op (its `up` does nothing) — the `schema_migrations` table is created by the runner, and there is no other schema to install yet. Reserving version 1 for the state store itself leaves consumer migrations to start at version 2+ on a clean numbering line.

Why TS modules and not `.sql` files: avoids a build-step file-copy (`tsc` doesn't ship non-`.ts` files), keeps versions / names / DDL co-located in a type-checked surface, and lets future migrations express anything `better-sqlite3` allows (multi-statement DDL, data backfills using `prepare`, conditional logic).

### How consumers extend it

Follow-up tickets (#23, #28, #36) each add one or more `NNN-<slug>.ts` files under `src/state-store/migrations/` and append the exported `Migration` to `BASE_MIGRATIONS` in `index.ts`. That gives a single, ordered source of truth and trivial review surface. The lightweight central registry is a deliberate choice: it's the smallest abstraction that gives ordered application, and the coupling is one-directional (consumers import nothing from state-store except the `Migration` type).

The `options.migrations` override exists for tests that need a tailored schema without polluting `BASE_MIGRATIONS`.

## Backup and safe-delete

### `backup(targetPath?)`

Uses `VACUUM INTO 'path'`. Properties of `VACUUM INTO`:

- Produces a defragmented copy of the entire database in a single, consistent transaction.
- Does not require the source to be quiet; readers and writers proceed.
- Output file is a plain SQLite DB — `sqlite3` CLI or `better-sqlite3` can open it directly.

Default target path when `targetPath` is omitted: `<source>.backup-<UTC-ISO>.db` — e.g. `~/.freesolo/state.db.backup-2026-06-04T17-23-18-499Z.db`. The timestamp uses filename-safe characters (colons and dots in the ISO timestamp replaced with hyphens).

Returns `{ path, bytes }` with the absolute path of the backup file. Throws `StateStoreError('backup-failed', …)` if the operation fails.

### `safeDelete()`

Replaces the live DB without losing data:

1. `close()` the database (idempotent if already closed).
2. Create `<FREESOLO_HOME>/trash/<UTC-ISO>/` directory.
3. Move `state.db`, `state.db-wal`, `state.db-shm` (any of those that exist) into the trash directory.
4. Return `{ trashDir, movedFiles }`.

After `safeDelete`, the next `openStateStore` call creates a fresh DB. The trash directory is never cleaned automatically — the operator decides when it's safe to `rm -rf`. Throws `StateStoreError('safe-delete-failed', …)` on filesystem errors.

## Concurrent writers

WAL mode lets multiple processes share the same DB file: readers do not block writers, multiple readers run in parallel, and one writer at a time serialises behind the WAL lock. With `busy_timeout = 5000`, a concurrent write attempt waits up to five seconds for the lock instead of failing immediately with `SQLITE_BUSY`.

That is sufficient for FreeSolo's expected load (low-frequency event writes from a handful of agent processes). The integration test (see Testing) drives this scenario explicitly to lock in the behaviour.

## Testing

All tests live under `tests/unit/` (matching repo convention). The concurrent-writer test that spawns subprocesses is still placed under `tests/unit/` for now since the repo's `tests/integration/` is reserved for `verify`/`start` CLI flows. If reviewers prefer a split later, we can revisit.

### Unit tests

| File | Coverage |
|---|---|
| `state-store-paths.test.ts` | `resolveDefaultPath` returns `<homedir>/.freesolo/state.db` and honours `FREESOLO_HOME`. |
| `state-store-connection.test.ts` | `openConnection` creates parent dir, returns a handle in WAL mode, applies expected pragmas, throws `StateStoreError('open-failed', …)` on permission errors. |
| `state-store-migrations.test.ts` | `schema_migrations` table is created; applies pending migrations in version order; idempotent on second open; rolls back on a failing migration; rejects duplicate versions; rejects applied-but-missing-from-supplied-list. |
| `state-store-backup.test.ts` | `backup()` produces a readable SQLite file with the same row counts as source; default target path follows the documented format; `backup-failed` raised on EACCES target dir. |
| `state-store-safe-delete.test.ts` | Moves `state.db` + WAL/SHM into a trash dir; close-before-move semantics; idempotent if files already absent; raises `safe-delete-failed` on EACCES trash dir. |
| `state-store-api.test.ts` | `openStateStore` returns a working `StateStore`; `transaction` rolls back on throw; `unsafe` exposes the raw DB; `close` is idempotent. |
| `state-store-engine-isolation.test.ts` | Regression: `src/workflow/` does not import from `src/state-store/`. |

### Concurrent-writer test

`state-store-concurrency.test.ts` spawns N child processes (where N is small, e.g. 4) via `child_process.fork` against a temp `state.db`. Each child runs a tiny script (registered via a test-only migration that adds a `test_events` table) that appends M rows tagged with the child's PID. The parent waits for all children to finish, then asserts:

- `test_events` table contains exactly N × M rows.
- Every PID has exactly M rows (no writer dropped writes).
- The row sequence ids are strictly monotonic globally (`SELECT id FROM test_events ORDER BY id`), proving no `SQLITE_BUSY` propagated out of the `busy_timeout`.

This pins WAL-mode + `busy_timeout` behaviour as a regression test for the "two FreeSolo processes appending events" acceptance criterion.

### Why no integration test under `tests/integration/`

The existing `tests/integration/` cases test the `freesolo` CLI (the `start` and `verify` commands). State-store consumers don't ship a CLI in this ticket, so there's no CLI surface to integration-test. The concurrent-writer unit test exercises the cross-process behaviour at the module boundary, which is the right level for this work.

## Dependencies

Added to `package.json`:

- `better-sqlite3` (runtime, `^11.0.0` — N-API based, prebuilt binaries for Node 20+ on common platforms).
- `@types/better-sqlite3` (dev).

`better-sqlite3` is a native module: it ships prebuilt binaries for darwin-arm64, darwin-x64, linux-x64, win32-x64 on Node 20 and 22. CI environments not matching these would fall back to compiling from source, which is fine for development but worth flagging in the PR description.

## Acceptance criteria mapping

| Issue criterion | Where satisfied |
|---|---|
| `~/.freesolo/state.db` is created on first use, with WAL enabled | `openConnection` ensures the parent directory exists and applies `journal_mode = WAL` on every open. `state-store-connection.test.ts` asserts both behaviours. |
| Migration runner applies pending migrations on startup | `runMigrations` is invoked unconditionally by `openStateStore`. `state-store-migrations.test.ts` exercises pending-application, idempotency, ordering, and rollback. |
| A single Node module exposes connection / transaction helpers consumed by Event Log, Worktree Metadata, Issue Watcher | `src/state-store/index.ts` is the only entry point. The public surface (`StateStore.prepare / exec / transaction / pragma / unsafe`) is sufficient for any DAO the consumers will need. |
| Tests cover concurrent-writer scenarios (two FreeSolo processes appending events) | `state-store-concurrency.test.ts` spawns N child processes, each writing rows in parallel against a shared DB. |

## Risks and open questions

- **Native-module install pain.** `better-sqlite3` ships prebuilds for the common Node 20/22 platforms. On platforms without a prebuild, `npm install` triggers a `node-gyp` compile. The PR description should call this out, and we should consider a CI matrix that covers the platforms we care about. Mitigation if it bites: pin to a version with broader prebuild coverage, or fall back to `node:sqlite` once Node 22 LTS is the project minimum.
- **No central composition root yet.** `openStateStore` is callable from anywhere, which is fine for now but invites N independent connections in long-lived processes. When the workflow engine grows a real composition root (#15 / #14 epic work), it will own a single `StateStore` instance and pass it down. This ticket does not need to solve that.
- **Trash directory grows forever.** `safeDelete` never cleans `<FREESOLO_HOME>/trash/`. Acceptable: the operator chose to delete the DB, so they can `rm -rf` when ready. If automatic cleanup ever matters, a `--keep-last N` flag on a future CLI command would solve it.
- **Schema migrations only go forward.** We do not ship `down` migrations. SQLite's lack of full `ALTER TABLE` support makes safe down-migrations hard; we lean on `safeDelete` + restore-from-backup as the rollback path instead. Recorded here so a future contributor doesn't add half-working `down` plumbing.
- **No CLI surface in this ticket.** A follow-up ticket can add `freesolo state-store backup|trash|info` if operator ergonomics demand it. Out of scope here.

## Recommendation

Ship the module as designed. The surface is small (one function, one type for migrations, a handful of helpers), the dependency footprint is one well-maintained native module, and every acceptance criterion has a named test. Consumer tickets (#23, #28, #36) can land in parallel after this one because they only need to (a) import `openStateStore`, (b) append a migration file, and (c) write their DAO.
