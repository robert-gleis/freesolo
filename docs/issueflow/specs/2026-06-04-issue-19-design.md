# Issue #19 — Worktree Manager Design

## Summary

Introduce a uniform TypeScript interface, `WorktreeManager`, that owns the *ownership and lifecycle* of worktrees — acquiring, releasing, listing, and reconciling orphans against the underlying disk. Plus one reference implementation, `InMemoryWorktreeManager`, that proves the interface is implementable and gives future engine and CLI code a deterministic test double.

This ticket explicitly does **not** ship persistent state, real disk placement, or any engine/CLI wiring. Those are follow-ups (#28 for SQLite persistence, future tickets for a real Worktrunk-backed placement adapter). The existing `src/core/worktree.ts` Worktrunk helpers are untouched.

Issue #19 is the structural counterpart to issue #18 (`Runner`) and #33 (`AgentAdapter`): the same shape of spec, the same "ship contract + one in-memory reference + isolation guard" strategy, orthogonal concern.

## Goals

- Make the workflow engine and future team-lifecycle code worktree-storage-agnostic by isolating ownership tracking, placement, and orphan reconciliation behind explicit interfaces.
- Cover the five acceptance criteria of issue #19 (configurable per-team-or-per-agent ownership, ownership tracked, cleanup, orphan detect + reap, idempotent and safe to retry) with the interface and the reference implementation.
- Provide one concrete `WorktreeManager` implementation that exercises the interface end-to-end and is usable as a fixture for downstream tests.
- Keep the v1 surface intentionally small so persistent and real-disk implementations can be added without renegotiating the contract.

## Non-Goals

- **No persistent storage.** `~/.issueflow/state.db` and the `worktrees` SQLite table are explicitly issue #28's scope; that ticket is blocked by both #19 and the SQLite State Store (#51). All state in this ticket lives in process memory.
- **No real disk placement.** A real `WorktreePlacement` that calls `wt switch --create` / `git worktree add` / `git worktree remove` is a follow-up ticket. The only implementation in this ticket is an in-memory test double.
- **No refactor of `src/core/worktree.ts`.** Those helpers (`switchNewIssueWorktree`, `resolveBranchWorktreePath`, `runWorktreeSetup`, `findExistingWorkspaceMatch`, etc.) remain the path used by `src/commands/start.ts`. They will be re-homed behind a future real Placement adapter in a later ticket.
- **No engine or CLI wiring.** No file under `src/workflow/`, `src/commands/`, or `src/bin.ts` changes. This ticket adds new code under `src/worktrees/` and `tests/unit/` only.
- **No streaming / event APIs.** The manager exposes a request-response surface only. Watch / subscribe semantics are deferred.
- **No multi-process locking.** The reference is single-process, in-memory. Concurrency hardening lands with the SQLite store (#51 / #28).
- **No *unsolicited* filesystem side effects from CRUD.** Reads never touch the filesystem. `acquire` calls `placement.ensure()` to provision the workspace it just claimed (this is the whole point of the operation). `release` only deletes from disk when the caller explicitly passes `deleteOnDisk: true`; otherwise it is registry-only. `reap` is the only operation that may delete disk state in response to a reconciler decision rather than a direct caller request, and only against a `WorktreeOrphan` produced by `findOrphans`.

## Conceptual Place in the Architecture

`CONTEXT.md` already names three orthogonal abstractions: `LaunchPlanBuilder` (what to launch), `Runner` (how to execute), `AgentAdapter` (protocol once running). `WorktreeManager` joins as the fourth:

| Module | Owns | Stateful? | Async? |
|---|---|---|---|
| `src/adapters/` (`LaunchPlanBuilder`) | The `{ binary, args, cwd, postLaunchNote? }` plan for a specific host | No | No |
| `src/runners/` (`Runner`) | The execution environment of one host process | Yes | Yes |
| `src/agents/` (`AgentAdapter`) | The protocol of one running agent | Yes | Yes |
| **`src/worktrees/` (`WorktreeManager`)** | **The ownership and lifecycle of the on-disk workspaces themselves** | **Yes** | **Yes** |

A worktree is a `git worktree` owned by IssueFlow (per `CONTEXT.md`). Until now, the only worktree code in the repo is `src/core/worktree.ts` — free functions called by the `issueflow start` CLI to place a single worktree for the current issue. There is no central record of which worktrees exist, who owns them, or what to clean up after a session ends. This ticket introduces that central record as an interface (`WorktreeManager`) with an in-memory reference, leaving real persistence and real placement to follow-ups.

Composition at the call site (future code, not in this ticket): the Team Lifecycle Manager (#41) will `manager.acquire({ owner: { kind: 'team', id }, intent })` to get a `WorktreeRecord`; an Agent (a Runner + an AgentAdapter) is then spawned with `record.worktreePath` as `cwd`. When the team finishes, the same code calls `manager.release({ id: record.id, deleteOnDisk: true })`. Periodically — e.g. on boot or via a future CLI sweep — orphan reconciliation runs `manager.findOrphans()` and may `manager.reap(orphan)` what it surfaces.

## Architecture

New code lives under `src/worktrees/`:

```
src/worktrees/
  types.ts         # WorktreeOwner, WorktreeOwnerKind, WorktreeRecord, WorktreeIntent, WorktreeLocation,
                   # WorktreeId, WorktreeOrphan, WorktreeOrphanKind, WorktreeOrphanReport,
                   # WorktreeManagerError, WorktreeManagerErrorCode
  manager.ts       # WorktreeManager interface
  placement.ts     # WorktreePlacement interface + InMemoryWorktreePlacement
  in-memory.ts     # InMemoryWorktreeManager
  index.ts         # Barrel re-export of the public surface
```

Why a separate top-level directory:

- `src/adapters/`, `src/agents/`, `src/runners/` already exist for the three other orthogonal abstractions; `WorktreeManager` is the fourth and gets its own home so future implementations (`src/worktrees/sqlite.ts`, `src/worktrees/worktrunk-placement.ts`) have an obvious place.
- `src/core/worktree.ts` is unchanged — it remains the tactical "drive Worktrunk from the CLI" helper module. It is *not* re-exported from `src/worktrees/`. Future work will introduce a Placement adapter that wraps these helpers, but that is out of scope here.

Engine code (`src/workflow/`) must not import from `src/worktrees/` in this ticket — there is no integration yet and an isolation regression test guards that.

## Domain Types

```ts
// src/worktrees/types.ts

export type WorktreeId = string;            // opaque identifier minted by the manager

export type WorktreeOwnerKind = 'agent' | 'team' | 'issue';

export interface WorktreeOwner {
  kind: WorktreeOwnerKind;
  id: string;                               // agent id, team id, or stringified issue number
}

export interface WorktreeIntent {
  branchName: string;                       // e.g. 'issue/19-worktree-manager'
  suggestedPath?: string;                   // hint to the placement; may be ignored
  issueNumber?: number;                     // cross-reference; required when owner.kind === 'issue'
}

export interface WorktreeLocation {
  path: string;
  branchName: string;
}

export interface WorktreeRecord {
  id: WorktreeId;
  owner: WorktreeOwner;
  location: WorktreeLocation;
  issueNumber: number | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type WorktreeOrphanKind =
  | 'dangling-record'                       // record holds a path no longer on disk
  | 'untracked-location';                   // disk has a worktree the manager never recorded

export type WorktreeOrphan =
  | { kind: 'dangling-record'; record: WorktreeRecord }
  | { kind: 'untracked-location'; location: WorktreeLocation };

export interface WorktreeOrphanReport {
  orphans: WorktreeOrphan[];
  scannedAt: Date;
}

export type WorktreeManagerErrorCode =
  | 'owner-already-acquired'                // acquire() called for an owner that holds a different live intent
  | 'placement-failed'                      // WorktreePlacement.ensure() threw
  | 'reap-failed'                           // WorktreePlacement.remove() threw during reap
  | 'invalid-intent';                       // intent fields are inconsistent (e.g. owner.kind === 'issue' but no issueNumber)

export class WorktreeManagerError extends Error {
  readonly code: WorktreeManagerErrorCode;

  constructor(code: WorktreeManagerErrorCode, message: string) {
    super(message);
    this.name = 'WorktreeManagerError';
    this.code = code;
  }
}
```

Notes on shape:

- **`WorktreeId` is opaque.** The manager mints it; callers must not parse it. The in-memory implementation uses a monotonically-increasing counter (`wt-1`, `wt-2`, …) so tests are deterministic. The SQLite-backed implementation in #28 will use its own scheme (likely the SQLite row id).
- **`issueNumber` is also recorded on every record**, regardless of `owner.kind`, so an agent- or team-owned worktree still answers "which issue?". When `owner.kind === 'issue'`, `intent.issueNumber` is required and must equal `Number(owner.id)`; this is validated in `acquire`.
- **`Date` everywhere, not ISO strings.** Matches the precedent set by `Runner.status()` and `AgentAdapter.status()`. Persistence layers serialise as they like.
- **No `metadata` blob.** YAGNI — if a future field is needed it gets a named slot.

## `WorktreeManager` Interface

```ts
// src/worktrees/manager.ts

import type {
  WorktreeId,
  WorktreeOrphan,
  WorktreeOrphanReport,
  WorktreeOwner,
  WorktreeIntent,
  WorktreeRecord
} from './types.js';

export interface AcquireInput {
  owner: WorktreeOwner;
  intent: WorktreeIntent;
  now?: Date;                               // injected clock for tests; defaults to new Date()
}

export interface ReleaseInput {
  id: WorktreeId;
  deleteOnDisk?: boolean;                   // when true, manager asks WorktreePlacement.remove()
  now?: Date;
}

export interface WorktreeManager {
  acquire(input: AcquireInput): Promise<WorktreeRecord>;

  release(input: ReleaseInput): Promise<void>;

  get(id: WorktreeId): Promise<WorktreeRecord | null>;
  findByOwner(owner: WorktreeOwner): Promise<WorktreeRecord | null>;
  list(): Promise<WorktreeRecord[]>;

  touch(id: WorktreeId, now?: Date): Promise<void>;

  findOrphans(now?: Date): Promise<WorktreeOrphanReport>;
  reap(orphan: WorktreeOrphan, now?: Date): Promise<void>;
}
```

### Semantics

- **`acquire`**
  - Validates the intent (`invalid-intent` if `owner.kind === 'issue'` and `intent.issueNumber` is missing or mismatched).
  - If a record already exists for `owner`:
    - **Same intent** (same `branchName`, same `issueNumber`, same `suggestedPath` — strict field-by-field equality, including `undefined` on both sides) → idempotent, returns the existing record with `lastSeenAt` refreshed. Placement is *not* re-invoked.
    - **Different intent** → throws `WorktreeManagerError('owner-already-acquired')`. Caller must release first.
  - Otherwise calls `placement.ensure(intent)` to get a `WorktreeLocation`. Mints a fresh `WorktreeId`, stores `WorktreeRecord` keyed by id and indexed by owner, and returns it. If `placement.ensure()` throws, the error is wrapped as `WorktreeManagerError('placement-failed')` and no record is stored.
- **`release`**
  - Unknown / already-released id → silent no-op (issue criterion: "safe to retry").
  - Known id → if `deleteOnDisk === true`, calls `placement.remove(record.location)`; in either case, removes the record from the registry. If `placement.remove()` throws, the record is left in place and the original error propagates so callers can decide whether to retry or escalate to `reap`.
- **`get` / `findByOwner` / `list`** — pure reads against the registry.
- **`touch`** — updates `lastSeenAt`; unknown id is a silent no-op.
- **`findOrphans`**
  - Calls `placement.list()` once; produces orphan list:
    - For every record whose `location.path` is not present in the placement listing → `{ kind: 'dangling-record', record }`.
    - For every location in the placement listing whose path is not present in any record → `{ kind: 'untracked-location', location }`.
  - Returns `{ orphans, scannedAt }`. Orphan order is stable: `dangling-record` entries first, sorted by `record.createdAt` ascending and then `record.id` lexicographically; then `untracked-location` entries, sorted by `location.path` lexicographically.
- **`reap`**
  - `dangling-record` → removes the record from the registry. Does *not* call `placement.remove()` (the path is already gone). Idempotent: a record id that is no longer present is a no-op.
  - `untracked-location` → calls `placement.remove(location)`. Idempotent: `remove` of an already-missing location must itself be a no-op (this contract is part of `WorktreePlacement`'s spec, see below). If `placement.remove()` throws, the error is wrapped as `WorktreeManagerError('reap-failed')`.

### Why this shape

- **`acquire` is registry-then-disk, `release` is disk-then-registry, but only on opt-in `deleteOnDisk`.** Keeps reads cheap and removes filesystem surprise from the common path. The Team Lifecycle Manager (future) will pass `deleteOnDisk: true` at end-of-team; the CLI can pass `false` when the human wants to keep the worktree around.
- **One owner = one live record.** Trying to overload an owner is a programming error, not a configuration question. The CLI / engine policy decides *what* `owner` to use; the manager only enforces the invariant.
- **`reap` is the only operation that deletes orphan locations.** Routine `release` does not delete unless asked. This prevents a buggy release in one part of the system from nuking work in another.

## `WorktreePlacement` Interface

```ts
// src/worktrees/placement.ts

import type { WorktreeIntent, WorktreeLocation } from './types.js';

export interface WorktreePlacement {
  // Provisions a worktree for the intent on disk. Idempotent: if the intent's
  // branch already has a worktree, returns its existing location.
  ensure(intent: WorktreeIntent): Promise<WorktreeLocation>;

  // Lists every worktree the placement knows about. Used by orphan reconciliation.
  list(): Promise<WorktreeLocation[]>;

  // Removes a worktree from disk. Idempotent: if the path is already gone, returns silently.
  remove(location: WorktreeLocation): Promise<void>;
}
```

### Reference: `InMemoryWorktreePlacement`

Stores a `Map<string, WorktreeLocation>` keyed by `branchName`. `ensure` returns the existing entry if `branchName` matches or, when absent, fabricates a path (e.g. `/inmem/<branchName>`), inserts it, and returns it. `list` returns `Array.from(map.values())`. `remove` deletes by `branchName` if present. Constructor accepts an optional override `pathFor: (intent) => string` so tests can inject deterministic paths or simulate `suggestedPath` honoring.

No filesystem I/O. No process spawns. No timers.

## Reference Implementation: `InMemoryWorktreeManager`

`InMemoryWorktreeManager` is the only `WorktreeManager` implementation in this ticket.

```ts
// src/worktrees/in-memory.ts

import type { WorktreeManager, AcquireInput, ReleaseInput } from './manager.js';
import type { WorktreePlacement } from './placement.js';
import type {
  WorktreeId,
  WorktreeOrphan,
  WorktreeOrphanReport,
  WorktreeOwner,
  WorktreeRecord
} from './types.js';

export interface InMemoryWorktreeManagerOptions {
  placement: WorktreePlacement;
  idFactory?: () => WorktreeId;             // defaults to a monotonic 'wt-N' counter
  now?: () => Date;                         // defaults to () => new Date()
}

export class InMemoryWorktreeManager implements WorktreeManager {
  // implementation in src/worktrees/in-memory.ts
}
```

Storage:

- `records: Map<WorktreeId, WorktreeRecord>` — the primary index.
- `ownerIndex: Map<string, WorktreeId>` — key is `${owner.kind}::${owner.id}`. Updated atomically with `records` on acquire/release.

Behavioural rules implemented exactly per the semantics above. `acquire` resolves placement after the owner-collision check but before mutating state, so a placement failure leaves the manager untouched.

## Errors

`WorktreeManagerError` is the only error class introduced by this module. Codes (`owner-already-acquired`, `placement-failed`, `reap-failed`, `invalid-intent`) cover every contract-level refusal path. Wrapping policy:

- **`acquire`** — any error from `placement.ensure()` is wrapped as `WorktreeManagerError('placement-failed')` so callers can branch on a stable code. The original error message is embedded in the wrapper's `message`.
- **`reap`** — any error from `placement.remove()` is wrapped as `WorktreeManagerError('reap-failed')` for the same reason.
- **`release`** — errors from `placement.remove()` propagate unchanged. `release` is a routine, mid-flight call where the caller already has the original error context; wrapping would discard the placement's structured error type (e.g. a future `WorktreePlacementError` with its own codes). Callers that want a uniform error surface can wrap at their boundary.
- **Validation errors** (`invalid-intent`, `owner-already-acquired`) are thrown directly by the manager and not wrapped.

Callers branch on `code`, not on `message` text.

## Testing

Three new test files, all under `tests/unit/`. No integration tests — there is no I/O to integrate against.

### `tests/unit/worktree-manager-types.test.ts`

Structural sanity for the public surface — mirrors `tests/unit/runner-types.test.ts`:

- Constructing a minimal inline `WorktreeManager` compiles and runs.
- `WorktreeOwnerKind` union is pinned to `'agent' | 'team' | 'issue'` (an `as const` array).
- `WorktreeManagerErrorCode` union is pinned to the four documented codes.
- `WorktreeManagerError` is instanceof `Error`, carries `code`, has `name === 'WorktreeManagerError'`.
- Barrel `src/worktrees/index.ts` re-exports `WorktreeManagerError` and `InMemoryWorktreeManager` as values and `WorktreeManager` as a type that `InMemoryWorktreeManager` satisfies.

### `tests/unit/in-memory-worktree-manager.test.ts`

Behavioural coverage. One `describe` block per operation; an injected `idFactory` and `now` produce deterministic outputs. Highlights:

- **acquire**
  - Acquires a fresh worktree for a new owner; record carries the supplied `branchName`, the placement-returned path, and the correct `issueNumber`.
  - Acquires for `owner.kind === 'issue'` requires `intent.issueNumber === Number(owner.id)`; mismatch throws `WorktreeManagerError('invalid-intent')`.
  - Double-acquire with the *same* intent returns the original record and refreshes `lastSeenAt`; placement.ensure is called exactly once.
  - Double-acquire with a *different* intent throws `WorktreeManagerError('owner-already-acquired')`.
  - Placement failure surfaces as `WorktreeManagerError('placement-failed')` and the registry remains empty.
- **release**
  - Known id with `deleteOnDisk: false` removes from registry only; placement.remove is not called.
  - Known id with `deleteOnDisk: true` calls placement.remove with the recorded location.
  - Unknown id is a silent no-op.
  - Already-released id is a silent no-op (called twice in a row).
  - If `placement.remove` throws during `release`, the record remains and the error propagates unchanged.
- **get / findByOwner / list**
  - Return `null` (or empty array) before any acquire.
  - Return the expected records after multiple acquires across different owner kinds.
- **touch**
  - Updates `lastSeenAt`; unknown id is a silent no-op.
- **findOrphans**
  - Empty registry + empty placement → empty `orphans`, populated `scannedAt`.
  - Dangling record: registry has X at /a/b; placement no longer lists /a/b → one orphan of kind `dangling-record`.
  - Untracked location: placement lists /c/d; no record points there → one orphan of kind `untracked-location`.
  - Both at once → both orphans returned; order is stable (records sorted by `createdAt` then id, locations sorted by `path`).
- **reap**
  - `dangling-record` orphan removes the record; placement.remove is not called.
  - `untracked-location` orphan calls placement.remove with the location; if placement.remove throws, error surfaces as `WorktreeManagerError('reap-failed')`.
  - Re-reaping the same orphan is a no-op (record already absent or location already removed).

### `tests/unit/worktree-engine-isolation.test.ts`

Regression guard, mirrors `tests/unit/runner-engine-isolation.test.ts`. Asserts:

- No file under `src/workflow/` contains an import path matching `'src/worktrees'`, `'../worktrees'`, `'./worktrees'`, or any sibling that resolves into `src/worktrees/`.
- Same test file enumerates the workflow files via `fs.readdir(..., { recursive: true })` so adding a new workflow file does not silently bypass the guard.

## Forward Compatibility

- **SQLite persistence (#28)** swaps the in-memory `records` / `ownerIndex` `Map`s for a SQLite-backed store implementing the same `WorktreeManager` interface. No changes to the interface; tests for the SQLite implementation will mirror the in-memory tests verbatim plus add concurrency cases.
- **Real placement (future ticket)** ships a `WorktrunkWorktreePlacement` (or similar) that wraps the existing `src/core/worktree.ts` helpers behind the `WorktreePlacement` interface. The `InMemoryWorktreeManager` is unchanged; only the constructor argument differs.
- **Engine wiring (future ticket)** lands when Team Lifecycle Manager (#41) ships. Until then the regression test guarantees the engine cannot accidentally depend on this module.

## ADRs

No new ADR. The persistence boundary is already covered by ADR-0001 ("State persistence: repo files for knowledge, SQLite for telemetry"), which places Worktree Metadata in `~/.issueflow/state.db`; that pillar is realised by #28, not this ticket. The introduction of `WorktreeManager` as a fourth orthogonal abstraction is in the same spirit as `Runner` and `AgentAdapter` — neither of which warranted an ADR — and so does not need one. If, in review, this surface becomes contentious, an ADR can be added before merge.
