# Plan Review — Issue #19 (Worktree Manager), Round 2

## Verdict

pass

## Summary

All four important findings from Round 1 are resolved. Three of the five important test gaps from Round 1 are resolved (id-lex tiebreaker, release-unknown-id placement.remove guard, touch-unknown-id-with-explicit-now), plus all suggestedPath coverage. The plan is implementable as written: every step has exact code or commands, no placeholders survive any task, TDD discipline holds, and spec coverage is complete.

The remaining unresolved items from Round 1 are all nits (ownerKey escaping, cosmetic spec label for WorktreeOwnerKind, Task 8 step label, test ordering). None block implementation. Two new minor nits were introduced by the fixer's edits and are noted below; neither requires a fix before implementation.

---

## Round 1 Follow-up

| # | Finding | Status |
|---|---|---|
| 1 | suggestedPath strict equality: spec-vs-impl drift, no pinning test | **RESOLVED.** Spec updated to "strict field-by-field equality, including `undefined` on both sides". New test "treats a one-sided suggestedPath (one undefined, the other set) as a different intent (strict equality)" added at Task 4 line 700 to pin the one-sided case. Both edges are now covered. |
| 2 | Commit messages lacked Co-Authored-By trailer / HEREDOC format | **RESOLVED.** Every Task N Step 5 now uses HEREDOC with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer. |
| 3 | Dead code in `findOrphans`: `onDiskByPath` map built but only used to return values identical to what was already in hand | **RESOLVED.** `onDiskByPath` is gone. `untrackedLocations` is built directly from `onDisk.filter(...)` with no intermediate map. |
| 4 | Stricter positive-integer validation (`Number.isInteger` + `> 0`) beyond the spec, unpinned by any test | **RESOLVED.** New test "rejects an issue owner.id that does not parse as a positive integer" added at Task 4 line 659 covering `'abc'`, `''`, and `'0'` cases. |
| 5 | Empty-string `owner.id` and zero-`issueNumber` corner cases unspecified and untested | **RESOLVED.** Covered by the tests added for Finding 4 above (lines 677–697). |
| 6 (nit) | `ownerKey` does not escape `'::'` in `owner.id` | **UNRESOLVED.** Still a nit; closed union mitigates any real collision. |
| 7 (nit) | `WorktreeOwnerKind` not listed in the types.ts responsibility blurb in the spec | **UNRESOLVED.** Cosmetic; plan exports it correctly. |
| 8 (nit) | Inconsistent `scannedAt` assertion across `findOrphans` tests | **RESOLVED.** Every `findOrphans` test in Task 6 now asserts `scannedAt.toISOString()`. |
| 9 (nit) | `WORKTREES_IMPORT_REGEX` scope undocumented | **RESOLVED.** A five-line comment was added explaining the static-relative-import-only scope and the precedent in `runner-engine-isolation.test.ts`. |
| 10 (nit) | Task 8 Step 1 heading still reads "Write the failing test" despite being a straight-to-green absence assertion | **UNRESOLVED.** The header says "Write the failing test" but the introductory callout above it correctly explains there is no red step. Mildly confusing for an executor but not ambiguous given the explanatory text. |
| 11 (nit) | First `invalid-intent` sub-case didn't assert `message` | **RESOLVED.** `message: expect.stringMatching(/missing/)` added at Task 4 line 645. |
| 12 (nit) | Release test ordering puts error-propagation test before re-usable-owner-after-release test | **UNRESOLVED.** Still the same order. Not a correctness issue. |
| 13 (nit) | Task 9 said "eight new test files" — incorrect count | **RESOLVED.** Now says "four new test files", which is correct. |
| 14 (nit) | Mixed `npm test --` vs `npx vitest run` invocation | **UNRESOLVED.** All tasks consistently use `npm test --`, which resolves to `vitest run` per `package.json`. Internally consistent even if different from issue-18's `npx vitest` form. |
| 15 (nit) | Defensive recovery branch in `acquire` had no comment | **RESOLVED.** Comment "defensive: indexes diverged due to a bug elsewhere" added at Task 4 line 918. |

Test gaps from Round 1:

| Gap | Status |
|---|---|
| No test for `id`-lex tiebreaker when two `dangling-record` entries share `createdAt` | **RESOLVED.** New test "falls back to id-lex order when two dangling records share createdAt" added at Task 6 line 1430. Explicitly asserts `r1.createdAt === r2.createdAt` then `orphans` order. |
| No assertion that `placement.remove` is NOT called on `release({ id, deleteOnDisk: true })` with an unknown id | **RESOLVED.** Test at Task 5 line 1074 now asserts `removeCalls.toHaveLength(0)` after both the no-`deleteOnDisk` and `deleteOnDisk: true` calls. |
| No test for `touch` on unknown id with explicit `now` | **RESOLVED.** Test "is a no-op for an unknown id even with an explicit now" added at Task 5 line 1251. |
| No test pinning the one-sided `suggestedPath` semantics | **RESOLVED.** See Finding 1 above. |

---

## New Findings

### NIT — Task 6 Step 4 describes "five describes" but the file actually contains six describe blocks

Task 6, Step 4 (plan line 1639):
> Expected: PASS — every test green across all five describes (acquire, release, get/findByOwner/list, touch, findOrphans, reap).

The parenthetical enumerates six describe blocks (acquire, release, get/findByOwner/list, touch, findOrphans, reap) but the prose says "five". The correct number is six. This is the same class of typo as the "eight test files" nit from Round 1 (which was fixed). Not a blocker — an implementer counting the actual blocks will see six pass, which is more than "five", so the check still succeeds. Recommend fixing the count.

### NIT — Task 4 acquire test count ("nine") is now exactly accurate but depends on the fixer having added the suggestedPath one-sided test

Round 1 had 8 acquire tests; the fixer added the one-sided-suggestedPath test bringing it to 9. The Step 4 expected output ("nine `acquire` tests green") is now correct. No action needed — this is a confirmation that the count is consistent, not a problem.

### NIT — Task 3 snippet appends an `import type` declaration after `describe` blocks

Task 3 instructs appending this to `worktree-manager-types.test.ts`:
```ts
import type { AcquireInput, ReleaseInput, WorktreeManager } from '../../src/worktrees/manager.js';

describe('WorktreeManager (structural)', () => { ... });
```

TypeScript's parser accepts `import` declarations anywhere at the module top level, and Vitest's esbuild transform hoists them. The TypeScript compiler (`tsc --noEmit`) does not error on mid-file static imports. This pattern works in practice. It is non-standard and a future reader or linter (e.g. `eslint-plugin-import`) might flag it, but it does not break the build or test run. The same append pattern is used in Task 7 for the barrel test. No action required; noting for awareness.

---

## Spec Coverage

| Spec section | Plan task(s) | Status |
|---|---|---|
| Domain Types (`types.ts`) — all nine export shapes | Task 1 | ✓ |
| `WorktreeManager` interface + `AcquireInput` / `ReleaseInput` | Task 3 | ✓ |
| `WorktreePlacement` interface + `InMemoryWorktreePlacement` | Task 2 | ✓ |
| `acquire` — fresh, idempotent, collision, placement-failed, invalid-intent, strict suggestedPath equality | Task 4 | ✓ |
| `release` — registry-only default, `deleteOnDisk: true`, no-op on unknown / already-released, error propagation unchanged, reuse after release | Task 5 | ✓ |
| `get` / `findByOwner` / `list` — pure reads | Task 5 | ✓ |
| `touch` — refresh, no-op on unknown, explicit `now` override | Task 5 | ✓ |
| `findOrphans` — empty, dangling-record, untracked-location, mixed, ordering (dangling first by createdAt then id-lex; untracked by path), id-tiebreaker | Task 6 | ✓ |
| `reap` — dangling-record removes record without placement, untracked calls placement.remove, reap-failed wrapping, no-op on already-reaped | Task 6 | ✓ |
| Barrel `src/worktrees/index.ts` (values: `WorktreeManagerError`, `InMemoryWorktreeManager`, `InMemoryWorktreePlacement`; types: `WorktreeManager`, `WorktreePlacement`, et al.) | Task 7 | ✓ |
| Engine isolation regression test (no `src/workflow/*.ts` imports `src/worktrees/...`) | Task 8 | ✓ |
| Full suite + typecheck gate | Task 9 | ✓ |
| Non-goals: no persistent state, no real disk placement, `src/core/worktree.ts` untouched, no engine/CLI wiring | Enforced by no existing file modifications and Task 8 regression guard | ✓ |

No spec section is missing a corresponding plan task.

---

## Tests

TDD discipline holds end-to-end. Each task: (1) failing test → (2) confirm failure mode → (3) minimal implementation → (4) green → (5) commit. Task 8 correctly documents why the red step is omitted (absence assertion).

Specific coverage checks:

- **Idempotency** — `acquire` same-intent (Task 4 line 722); `release` retry (Task 5 line 1094); `reap` dangling re-reap (Task 6 line 1552) and untracked re-reap (Task 6 line 1499). All covered. ✓
- **Error wrapping** — `placement-failed` (Task 4 line 792 pins `code` and `message: stringContaining('disk full')`); `reap-failed` (Task 6 line 1526 pins `code` and `message: stringContaining('rm: permission denied')`). ✓
- **Error propagation unchanged for `release`** — Task 5 line 1110 expects `message: 'rm: permission denied'` (unwrapped Error, not WorktreeManagerError). Matches spec. ✓
- **Orphan ordering** — Task 6 line 1389 (mixed case, distinct `createdAt`); Task 6 line 1430 (id-lex tiebreaker when `createdAt` is identical). Both fully covered and include `scannedAt` assertions. ✓
- **Atomicity on placement failure** — Task 4 line 818: verifies `list()` and `findByOwner` both return empty/null after placement failure. ✓
- **Owner reuse after release** — Task 5 line 1136. ✓
- **`release` no-op on unknown id with `deleteOnDisk: true` does not call placement.remove** — Task 5 line 1074, asserts `removeCalls.toHaveLength(0)`. ✓
- **`touch` with explicit `now` on unknown id** — Task 5 line 1251. ✓
- **Placement `remove` keyed by `branchName`, not `path`** — Task 2 line 359. ✓

No coverage gaps remain for documented semantics.

---

## Type Consistency

- `WorktreeId` is `string` (opaque alias) consistently across all source modules and test fixtures. ✓
- `AcquireInput.now` and `ReleaseInput.now` are `Date` (per-call value overrides); `InMemoryWorktreeManagerOptions.now` is `() => Date` (per-instance clock factory). Split is respected throughout. ✓
- `WorktreeRecord.issueNumber` is `number | null` (never `undefined`) everywhere — types.ts, test fixtures, implementation (`intent.issueNumber ?? null`). ✓
- `WorktreeOrphan` discriminator (`kind`) matches between `types.ts`, `in-memory.ts`, and all test assertions. ✓
- `WorktreeManagerErrorCode` union is identical in `types.ts`, the structural test, and every throw site in `in-memory.ts`. ✓
- `Date` types are used everywhere (no ISO strings in the domain layer). ✓
- Barrel re-exports `WorktreeManagerError`, `InMemoryWorktreeManager`, `InMemoryWorktreePlacement` as values; `WorktreeManager`, `WorktreePlacement`, and all types as type-only exports. Structural test in Task 7 verifies value presence at runtime. ✓
- `satisfies Partial<WorktreeManagerError>` usage in `rejects.toMatchObject` calls is valid TypeScript 4.9+ syntax; project uses TypeScript 5.9. ✓
