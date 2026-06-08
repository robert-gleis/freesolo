# Implementation Review — Issue #19, Round 1

## Verdict
pass_with_findings

## Verification commands run
- `npm test`: PASS — 37 test files, **304 tests**, all green. The four new test files contribute 15 (`worktree-manager-types.test.ts`) + 7 (`in-memory-worktree-placement.test.ts`) + 30 (`in-memory-worktree-manager.test.ts`) + 2 (`worktree-engine-isolation.test.ts`) = 54 tests.
- `npx tsc -p tsconfig.json --noEmit`: PASS — clean, no type errors.
- Manual inspection of `src/workflow/` imports: no file imports from `src/worktrees/`. Engine isolation holds.

---

## Spec Coverage

| Acceptance criterion | Where satisfied |
|---|---|
| Configurable per-team-or-per-agent ownership | `WorktreeOwner.kind: WorktreeOwnerKind` (`src/worktrees/types.ts:5-8`); `ownerKey()` keying (`in-memory.ts:27-29`) |
| Ownership tracked (one live record per owner) | `ownerIndex` Map (`in-memory.ts:68`); `owner-already-acquired` guard (`in-memory.ts:89-94`) |
| Cleanup (`release`) | `release()` in `in-memory.ts:121-135`; `deleteOnDisk: true` delegates to `placement.remove()` |
| Orphan detect + reap | `findOrphans()` (`in-memory.ts:163-193`); `reap()` (`in-memory.ts:195-212`) |
| Idempotent and safe to retry | `acquire` same-intent path (`in-memory.ts:86-88`); `release` unknown-id no-op (`in-memory.ts:123-125`); `touch` unknown-id no-op (`in-memory.ts:156-158`); `reap` dangling-record re-reap no-op (`in-memory.ts:196-199`) |
| Engine isolation | `tests/unit/worktree-engine-isolation.test.ts` |
| WorktreePlacement contract | `src/worktrees/placement.ts`; `InMemoryWorktreePlacement` reference implementation |
| Barrel re-export | `src/worktrees/index.ts` |

All five acceptance criteria are met.

---

## Findings

### 1. (nit) `ReleaseInput.now` is accepted but never used

**Severity:** nit  
**Location:** `src/worktrees/manager.ts:18` (declaration), `src/worktrees/in-memory.ts:121-135` (implementation)

`ReleaseInput` carries a `now?: Date` field that the `release()` implementation completely ignores. `release` removes a record and optionally calls `placement.remove()`; it does not update any timestamp, so there is no use for a clock injection point here. This field appears to be cargo-copied from `AcquireInput` / `ReleaseInput` in the plan without re-examining whether `release` needs clock injection. There is no test that exercises the `now` field on `ReleaseInput`.

**Suggested fix:** Remove `now?: Date` from `ReleaseInput`. If a future implementation needs it (e.g. for an audit timestamp), it can be added then. Removing it now keeps the interface tighter and prevents confusion.

---

### 2. (nit) `WorktreeOrphanKind` is not pinned in the types test

**Severity:** nit  
**Location:** `tests/unit/worktree-manager-types.test.ts`

`WorktreeOwnerKind` is pinned with an exhaustive `as const` array in the test (line 17-20). `WorktreeManagerErrorCode` is also pinned (lines 177-187). `WorktreeOrphanKind` is exported from `src/worktrees/types.ts:30` and re-exported from the barrel, but there is no corresponding test that pins the union to `'dangling-record' | 'untracked-location'`. Following the established pattern from `runner-types.test.ts` and the other pinned unions, this gap is minor — a rename of one variant would be caught at compile time by the discriminated-union guards in the tests — but the test intent here is structural documentation, not just type-checking.

**Suggested fix:** Add a two-element `WorktreeOrphanKind[]` pin test matching the pattern already established for `WorktreeOwnerKind`:

```ts
describe('WorktreeOrphanKind', () => {
  it('pins the union to dangling-record | untracked-location', () => {
    const all: WorktreeOrphanKind[] = ['dangling-record', 'untracked-location'];
    expect(all).toHaveLength(2);
  });
});
```

---

### 3. (nit) `input.now` per-call override on `acquire` is not tested

**Severity:** nit  
**Location:** `src/worktrees/manager.ts:13`, `src/worktrees/in-memory.ts:87, 106`

`AcquireInput.now` allows callers to inject a specific timestamp for a single `acquire` call, overriding the constructor-level `now()` factory. The code correctly plumbs this (`input.now ?? this.now()`) in both the idempotent re-acquire path (line 87) and the fresh-acquire path (line 106), but no test exercises the field. The analogous field on `ReleaseInput` is also untested (see finding 1). By contrast, `touch(id, now?)` explicitly tests the per-call `now` argument (two dedicated test cases).

**Suggested fix:** Add a test case that passes `now: new Date('...')` explicitly to `acquire` and asserts `createdAt` equals that value, mirroring the existing `touch` tests.

---

### 4. (nit) Whitespace-padded and scientific-notation `owner.id` values pass validation

**Severity:** nit  
**Location:** `src/worktrees/in-memory.ts:43-55`

`validateIssueOwnerIntent` uses `Number(owner.id)` to parse the issue number. JavaScript's `Number()` coerces `'  19  '` → `19` and `'1e2'` → `100`, both of which pass `Number.isInteger(...) && n > 0`. A caller who stores `owner.id = '  19  '` with `intent.issueNumber = 19` will succeed but produce an `ownerKey` of `'issue::  19  '` instead of `'issue::19'`, which could result in owner-lookup misses. The spec says `owner.id` should be a "stringified issue number" but does not formally define allowed forms.

This is not a bug in the current usage domain (callers who construct `WorktreeOwner` from real GitHub issue numbers will always use clean decimal strings), but the validation gap could matter if this constructor is called from user-controlled input in future CLI code.

**Suggested fix:** Replace `Number(owner.id)` with an explicit decimal-integer check:

```ts
const parsed = /^\d+$/.test(owner.id) ? Number(owner.id) : NaN;
if (!Number.isFinite(parsed) || parsed <= 0) { ... }
```

This would reject `'  19  '`, `'1e2'`, `'1.0'`, etc., matching the natural intent of "stringified issue number".

---

### 5. (nit) Returned `WorktreeRecord` objects are mutable references to internal state

**Severity:** nit  
**Location:** `src/worktrees/in-memory.ts:137-153` (`get`, `findByOwner`, `list`)

`get`, `findByOwner`, `list`, and `acquire` all return direct references to the internal `WorktreeRecord` objects rather than defensive copies. Because `WorktreeRecord` contains mutable `Date` fields (`createdAt`, `lastSeenAt`), a caller could accidentally corrupt internal state:

```ts
const r = await manager.get(id);
r!.lastSeenAt = new Date(0); // silently corrupts the registry
```

Additionally, `createdAt` and `lastSeenAt` are assigned the same `Date` object reference on fresh acquire (`const createdAt = input.now ?? this.now(); record = { ..., createdAt, lastSeenAt: createdAt }`). As long as neither is mutated in place (only by reassignment), this is safe — but the aliasing is a latent hazard.

For a test double in an in-memory, single-process implementation, this is an acceptable tradeoff. A future SQLite implementation would reconstruct records from rows and naturally avoid the issue. However, since `InMemoryWorktreeManager` is intended to be used as a fixture in downstream tests (per the spec), callers inadvertently mutating returned records could produce hard-to-diagnose test pollution.

**Suggested fix:** This is low-priority given the scope. Document the aliasing in a JSDoc comment on the class, or shallow-copy the record in `get`/`findByOwner`/`list` (cloning Date fields). Do not block on this.

---

## Test Quality

**Behavior vs implementation:** All tests are behavior-oriented. They assert observable state transitions (returned records, updated timestamps, thrown errors, index cleanups) rather than internal data structure layout. The `InternalRecord` interface is correctly private and never accessed from tests.

**Readability:** Test helpers `makeClock` and `makeIdFactory` are clean, self-contained, and easy to follow. The `satisfies Partial<WorktreeManagerError>` pattern (used to type-check `toMatchObject` shapes) is a nice improvement over plain object literals and matches the test style of `scripted-runner.test.ts`.

**Determinism:** All tests that care about timestamps inject a deterministic clock; no test uses `Date.now()` or `new Date()` for assertions. The `makeIdFactory` helper ensures predictable record IDs.

**Gaps identified:**

- `AcquireInput.now` per-call override is not tested (finding 3).
- `WorktreeOrphanKind` is not pinned (finding 2).
- No test for `release` with an explicit `now` argument (but since `now` in `ReleaseInput` is unused, this is a consequence of finding 1).
- The `reap` tests do not exercise a `dangling-record` orphan where the ownerIndex must also be cleaned up (i.e., verifying that `reap` removes from `ownerIndex` so a future `acquire` with the same owner succeeds). However this is implied by the `records.delete` + `ownerIndex.delete` pairing that is already tested transitively through `release` tests. Not a blocker.
- The `list()` result order is unspecified by the interface and untested. The in-memory implementation returns insertion order (Map iteration). This is fine given the spec is silent on ordering, but worth noting for downstream consumers.

**Coverage against spec semantics:** All documented semantics from the spec's "Semantics" section are exercised:
- `acquire`: fresh, idempotent, different-intent collision, invalid-intent (missing issueNumber, mismatched issueNumber, non-integer owner.id), placement failure, one-sided `suggestedPath`.
- `release`: registry-only, with disk, unknown id (two cases: without and with `deleteOnDisk: true`), double-release, placement error leaves record in place, owner reuse after release.
- `get / findByOwner / list`: empty, populated, unknown lookups.
- `touch`: known id via injected clock, known id via explicit arg, unknown id (two cases).
- `findOrphans`: empty, dangling-record, untracked-location, both together with sort order, createdAt tie-break.
- `reap`: dangling-record (no placement.remove), untracked-location (idempotent, placement.remove called), reap-failed wrapping, re-reap no-op.

---

## Code Quality

**Correctness:**

- The `release` error-propagation path is correct: `placement.remove()` is awaited before the `records.delete` / `ownerIndex.delete` calls, so a throw exits before any registry mutation. The record and owner index remain intact.
- The `acquire` defensive branch (diverged indexes) correctly falls through to create a new record after healing the `ownerIndex`.
- `intentsEqual` correctly handles the asymmetric `suggestedPath` case (`undefined !== '/foo'`) via JavaScript's `===` semantics.
- `findOrphans` correctly uses `path` (not `branchName`) as the key for the `onDiskPaths` set. This is consistent with the placement contract, which uses `branchName` as its key internally but exposes `path` as the location identifier to the manager.
- Sort stability: `danglingEntries.sort()` is by `createdAt.getTime()` then `id` lexicographic. The test correctly verifies both the primary sort (different `createdAt`) and the tie-break (same `createdAt`, lex id). V8's `Array.prototype.sort` is stable since Node.js 11+, so tie-breaking within the same `createdAt` is deterministic.
- The `reap` implementation calls `ownerIndex.delete(ownerKey(entry.record.owner))` for `dangling-record` orphans. This is correct — reaping a dangling record must also clean the owner index or future `acquire` calls for that owner would get an `owner-already-acquired` error despite the record being gone.

**Clarity:** Code is well-commented at decision boundaries (`// defensive: indexes diverged`, `// Bubble placement errors up unchanged`). Function names match domain terminology from CONTEXT.md. The `InternalRecord` wrapper struct clearly separates the public `WorktreeRecord` from the internal `intent` snapshot used for idempotency comparison.

**YAGNI:** The implementation contains no speculative features. All methods are in scope. The `_now` parameter to `reap` is accepted but unused (the parameter was declared in the interface; since `reap` for `dangling-record` does no time-sensitive work and `untracked-location` only calls `placement.remove` with no timestamp, this is reasonable). This is a minor inconsistency — `reap` accepts `now?` but ignores it — but the interface signature is locked, and the spec does not define a use for it in `reap`.

**Pattern consistency:** The module follows the `src/runners/` and `src/agents/` patterns precisely: `types.ts` for domain types, a named interface file, a reference implementation, and a barrel `index.ts`. Import paths use `.js` extensions per NodeNext convention. Tests use `describe / it` and are flat under `tests/unit/`.

**No security vulnerabilities or data loss scenarios identified.** The only mutation that could cause data loss would be a caller mutating returned `WorktreeRecord` objects (finding 5), which is a documentation/convention issue rather than a security issue.

---

## Summary

The implementation is correct, complete, and consistent with the spec and codebase conventions. All 54 new tests pass; the TypeScript build is clean; the full 304-test suite is green. The five findings are all nits — none of them represent incorrect behavior or missing spec coverage. The most actionable fix is removing `ReleaseInput.now` (finding 1) since it is an unused public API surface that will confuse future implementors. Finding 2 (pin `WorktreeOrphanKind`) is a one-line test addition to match the established pattern. Findings 3–5 are low-priority observations.

The implementation is solid enough to merge as-is, but the `ReleaseInput.now` cleanup (finding 1) is worth a quick fix before merging to keep the public interface clean.
