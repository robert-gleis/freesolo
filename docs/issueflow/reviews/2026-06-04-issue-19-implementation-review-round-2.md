# Implementation Review — Issue #19, Round 2

## Verdict

**pass**

All five Round 1 findings were resolved correctly. No new defects or regressions were introduced. All five acceptance criteria remain covered. The full 306-test suite is green; TypeScript is clean.

---

## Verification commands run

- `npm test`: PASS — 37 test files, **306 tests** (up from 304 in Round 1). The four worktrees test files now contribute 16 + 7 + 31 + 2 = 56 tests (up from 54).
- `npx tsc -p tsconfig.json --noEmit`: PASS — zero type errors.
- Manual inspection of `src/workflow/` imports: no file imports from `src/worktrees/`. Engine isolation holds.

---

## Round 1 Follow-Up

### Finding 1 — `ReleaseInput.now` unused field: RESOLVED

`ReleaseInput.now?: Date` was removed from `src/worktrees/manager.ts`. The interface is now:

```ts
export interface ReleaseInput {
  id: WorktreeId;
  deleteOnDisk?: boolean;
}
```

No test exercises a missing `now` on `ReleaseInput` — the field simply no longer exists, which is the correct fix.

### Finding 2 — `WorktreeOrphanKind` not pinned: RESOLVED

A new `describe('WorktreeOrphanKind')` block was added to `tests/unit/worktree-manager-types.test.ts` (lines 24–29), pinning the union to `['dangling-record', 'untracked-location']` with a two-element length assertion. This matches the established pattern for `WorktreeOwnerKind` and `WorktreeManagerErrorCode`. The types test file now has 16 tests (was 15).

### Finding 3 — `AcquireInput.now` per-call override untested: RESOLVED

A new test case `'honors an explicit now argument to acquire, overriding the options-level clock'` was added (lines 276–291 of `in-memory-worktree-manager.test.ts`). The test injects a constructor-level clock returning `10:00`, passes `now: new Date('15:00')` to `acquire`, and asserts `createdAt` is `15:00`. This correctly verifies the `input.now ?? this.now()` priority in both the fresh-acquire and re-acquire paths. The manager test file now has 31 tests (was 30).

### Finding 4 — Whitespace/scientific-notation `owner.id` passes validation: RESOLVED

`validateIssueOwnerIntent` now uses `/^\d+$/.test(owner.id)` as the primary guard before calling `Number()`, rejecting `'  19  '`, `'1e2'`, `'1.0'`, `'0'`, empty string, and non-numeric strings. The implementation at `in-memory.ts:43` is:

```ts
const isValid = /^\d+$/.test(owner.id) && Number(owner.id) > 0;
```

This is the exact fix suggested in Round 1. Tests for all five edge cases (`'abc'`, `''`, `'0'`, `'  19  '`, `'1e2'`) were added (lines 96–152 of the manager test file, within the existing `rejects an issue owner.id that does not parse as a positive integer` test).

### Finding 5 — Mutable references to internal state: RESOLVED (documentation path)

A JSDoc comment was added to the class declaration (`in-memory.ts:64`):

```ts
/** Records returned by `get`, `findByOwner`, and `list` are live references to internal state. Callers must not mutate them. */
```

This is the correct resolution given the scope: the comment documents the aliasing contract without introducing defensive copying overhead for the in-memory test double.

---

## New Findings

No new defects found. The following are very minor observations for completeness; none block merge.

### Observation A — `findOrphans(now?)` per-call override is untested (carry-forward, not a new gap)

The `findOrphans` interface accepts an optional `now?: Date` parameter. All test calls use the constructor-level clock (e.g. `now: makeClock([..., '2026-06-04T10:30:00.000Z'])`), which correctly exercises the `now ?? this.now()` path via the second clock tick. There is no test that passes `now` directly to `findOrphans()`. This is a minor gap consistent with the scope boundary; the clock injection mechanism is already exercised by `touch` and `acquire` per-call tests, so the `findOrphans` path is structurally identical and the risk is negligible. Not a blocker.

### Observation B — `reap` dangling-record test does not assert `findByOwner` returns null (carry-forward from Round 1)

The `'removes a dangling-record from the registry without touching placement'` test asserts `get(record.id)` returns `null` but does not call `findByOwner(record.owner)`. The `ownerIndex.delete(ownerKey(entry.record.owner))` call in `reap` at `in-memory.ts:204` is correct and is transitively covered by the implementation — but the test does not independently assert the owner index is clean after a reap. This means a regression that forgets `ownerIndex.delete` in `reap` (while keeping `records.delete`) would not be caught by the reap tests alone. The gap was noted in Round 1 as "not a blocker"; it remains not a blocker. A follow-up could add `expect(await manager.findByOwner(record.owner)).toBeNull()` to the reap dangling-record test and `expect(await manager.acquire({ owner: record.owner, intent: { ... } })).resolves.toBeDefined()` to confirm the owner slot was freed.

---

## Spec Coverage

| Acceptance criterion | Where satisfied |
|---|---|
| Configurable per-team-or-per-agent ownership | `WorktreeOwner.kind: WorktreeOwnerKind` (`types.ts:3`); `ownerKey()` keying (`in-memory.ts:27–29`) |
| Ownership tracked (one live record per owner) | `ownerIndex` Map (`in-memory.ts:70`); `owner-already-acquired` guard (`in-memory.ts:91–95`) |
| Cleanup (`release`) | `release()` at `in-memory.ts:123–137`; `deleteOnDisk: true` delegates to `placement.remove()` |
| Orphan detect + reap | `findOrphans()` at `in-memory.ts:165–195`; `reap()` at `in-memory.ts:197–214` |
| Idempotent and safe to retry | Same-intent `acquire` (`in-memory.ts:88–90`); unknown-id `release` no-op (`in-memory.ts:124–126`); `touch` unknown-id no-op (`in-memory.ts:158–160`); `reap` dangling-record re-reap no-op (`in-memory.ts:199–201`) |
| Engine isolation | `tests/unit/worktree-engine-isolation.test.ts` — guards against workflow imports |
| `WorktreePlacement` contract + reference | `src/worktrees/placement.ts`; `InMemoryWorktreePlacement` |
| Barrel re-export | `src/worktrees/index.ts` — all value and type symbols present |

All five acceptance criteria are met and unchanged from Round 1.

---

## Tests

### Correctness

All assertions are behavior-oriented: observable state transitions, thrown error codes, registry contents, and index cleanup. No test reaches into private fields.

The `satisfies Partial<WorktreeManagerError>` pattern used throughout for `toMatchObject` shapes continues to provide compile-time type safety on the expected shape.

The new test for `acquire` per-call `now` correctly verifies the `input.now` argument takes precedence over the constructor clock by setting them to distinct timestamps and asserting `createdAt` equals the per-call value.

The four edge-case `owner.id` tests (empty string, `'0'`, `'  19  '`, `'1e2'`) are each self-contained within the `rejects an issue owner.id that does not parse as a positive integer` test case and all `rejects.toMatchObject({ code: 'invalid-intent' })`. This coverage is clean.

### Completeness

Spec-required test scenarios confirmed present:
- `acquire`: fresh (team/agent/issue owners), idempotent re-acquire, different-intent collision, all four `invalid-intent` paths, placement failure, per-call `now` override, one-sided `suggestedPath` asymmetry.
- `release`: registry-only, with disk deletion, unknown id (both with and without `deleteOnDisk: true`), double-release, placement error leaves record in place, owner reuse after release.
- `get / findByOwner / list`: empty, multiple owner kinds, unknown lookups.
- `touch`: constructor clock, per-call `now`, unknown id (both with and without explicit `now`).
- `findOrphans`: empty agreement, dangling-record, untracked-location, both together with stable sort, `createdAt` tie-break.
- `reap`: dangling-record (no placement.remove), untracked-location (idempotent via placement, both calls go through), `reap-failed` wrapping, re-reap dangling-record no-op.

Remaining minor gaps (Observations A and B above) are not spec violations.

---

## Code Quality

The implementation is unchanged in structure from Round 1 except for the three targeted fixes:

1. `ReleaseInput.now` removed — interface is tighter.
2. `/^\d+$/.test(owner.id)` — validation is stricter and explicit.
3. JSDoc on `InMemoryWorktreeManager` — contract is documented.

No speculative features were added. Import paths remain `.js`-suffixed per NodeNext convention. The module follows the `src/runners/` and `src/agents/` patterns exactly.

No security vulnerabilities or data loss scenarios identified.

---

## Summary

The fixer addressed all five Round 1 findings correctly and in scope. The two additions that crossed the threshold from nit to resolved (`ReleaseInput.now` removal and `WorktreeOrphanKind` pinning) plus the two targeted improvements (`acquire.now` test, `/^\d+$/` validation) are all correct and well-tested. The JSDoc comment documents the mutable-reference hazard without over-engineering the in-memory test double.

The implementation is correct, complete, and consistent with the spec and codebase conventions. 306 tests pass; TypeScript is clean; engine isolation holds. **Ready to merge.**
