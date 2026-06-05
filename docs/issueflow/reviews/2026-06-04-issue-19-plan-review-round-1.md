# Plan Review — Issue #19 (Worktree Manager), Round 1

## Verdict

pass_with_findings

## Summary

The plan faithfully mirrors the spec's structural and behavioural contract for `WorktreeManager` and `WorktreePlacement`: identifier names, the `WorktreeOwnerKind` and `WorktreeManagerErrorCode` unions, every field on `WorktreeRecord`, `WorktreeOrphan`, `WorktreeOrphanReport`, the `AcquireInput`/`ReleaseInput` shapes, and the orphan ordering rule (`dangling-record` first by `createdAt`/id, then `untracked-location` by `path`) all match the spec verbatim. The 9-task TDD progression (types → placement → manager interface → acquire → release/touch/reads → findOrphans/reap → barrel → engine-isolation guard → full-suite gate) is implementable as written; each task has a concrete failing-test step (with the exact expected failure mode), the minimal-viable code, and a commit. The orthogonal-axis isolation is preserved (no existing files modified, `src/core/worktree.ts` untouched, `src/workflow/` regression-guarded). The findings below are mostly small spec-vs-impl drifts and missing edge-case coverage rather than structural problems.

## Spec coverage

| Spec section | Plan task(s) |
|---|---|
| Domain Types (`src/worktrees/types.ts` — `WorktreeId`, `WorktreeOwner(Kind)`, `WorktreeIntent`, `WorktreeLocation`, `WorktreeRecord`, `WorktreeOrphan(Kind)`, `WorktreeOrphanReport`, `WorktreeManagerError(Code)`) | Task 1 |
| `WorktreeManager` interface (`acquire`, `release`, `get`, `findByOwner`, `list`, `touch`, `findOrphans`, `reap`) + `AcquireInput`/`ReleaseInput` | Task 3 |
| `WorktreePlacement` interface (`ensure`, `list`, `remove`) and `InMemoryWorktreePlacement` reference | Task 2 |
| `acquire` semantics — fresh acquire, idempotency on same-intent re-acquire, owner-already-acquired collision, placement-failed wrapping, `invalid-intent` validation, registry empty after placement failure | Task 4 |
| `release` semantics — registry-only by default, `deleteOnDisk: true` triggers `placement.remove`, no-op on unknown / already-released id, error propagation unchanged from `placement.remove`, owner reusable after release | Task 5 |
| `get` / `findByOwner` / `list` — pure reads, return `null`/`[]` before any acquire, populated after | Task 5 |
| `touch` — refresh `lastSeenAt`, no-op on unknown id, optional explicit `now` | Task 5 |
| `findOrphans` — empty case, dangling-record case, untracked-location case, mixed case with documented ordering (dangling-by-createdAt-then-id, then untracked-by-path) | Task 6 |
| `reap` — dangling-record removes record without touching placement, untracked-location calls placement.remove and is idempotent, `reap-failed` wrapping, no-op on already-reaped | Task 6 |
| `src/worktrees/index.ts` barrel (values: `WorktreeManagerError`, `InMemoryWorktreeManager`, `InMemoryWorktreePlacement`; types: `WorktreeManager`, `WorktreePlacement`, et al.) | Task 7 |
| Engine isolation regression test (no `src/workflow/*.ts` imports `src/worktrees/...`) | Task 8 |
| Full suite + typecheck gate | Task 9 |

No spec sections are gap-uncovered. Gaps that exist are within sections (specific edge cases or wording mismatches), captured under Findings.

## Findings

1. **important — `intentsEqual` is stricter than the spec on `suggestedPath` (plan: `src/worktrees/in-memory.ts`, lines 786-792 of plan; spec line 184).** The spec says "Same intent (same `branchName`, same `issueNumber`, same `suggestedPath` if both sides specified one)" — i.e. `suggestedPath` should only collide when **both** intents specify it and they differ. The plan's implementation is `a.suggestedPath === b.suggestedPath` which treats `{ branchName: 'x' }` vs `{ branchName: 'x', suggestedPath: '/foo' }` as a collision (one is `undefined`, the other is `'/foo'`). The Task 4 test on line 691-711 ("differing optional suggestedPath as a different intent") only covers the case where both sides specify a path (`'/a'` vs `'/b'`), so this drift would not be caught. **Suggested fix:** Either align the spec to the implementation's stricter rule (drop "if both sides specified one") or change `intentsEqual` to treat one-sided `suggestedPath` as equal:
   ```ts
   const suggestedPathEqual =
     a.suggestedPath === undefined ||
     b.suggestedPath === undefined ||
     a.suggestedPath === b.suggestedPath;
   ```
   Add a Task 4 test that pins whichever rule you keep so a future reader can't drift back.

2. **important — Commit messages drop the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer used by every issue-#18 commit (plan: every task's Step 5; precedent: actual git history `git log` and issue-18 plan).** The issue-18 plan uses HEREDOC `-m "$(cat <<'EOF' … Co-Authored-By: … EOF )"`; the issue-19 plan uses bare `git commit -m "..."` with no trailer. Recent commits in this branch (`4cf4804`, `c3bc5aa`, `f26ff28`, etc.) all carry the trailer. **Suggested fix:** Convert every Task N Step 5 in the plan to the HEREDOC format with the trailer, matching the precedent.

3. **important — `findOrphans` builds `onDiskByPath` and uses `onDiskByPath.get(location.path) ?? location` but the value is identical to what `untrackedLocations.filter(...)` already holds (plan: `findOrphans` body, lines 1454-1461).** The `onDiskByPath` map is created from `onDisk`, and `untrackedLocations` is built by filtering `onDisk` — every `location` in `untrackedLocations` already IS the value `onDiskByPath` would return. This is dead code; the line `location: onDiskByPath.get(location.path) ?? location` always resolves to `location`. **Suggested fix:** Drop `onDiskByPath` and write `({ kind: 'untracked-location', location })` directly. Smaller surface, less to read.

4. **important — No test for `stop()`/`reap` covers the case where `Number.isInteger` guard on `owner.id` fires (plan: `validateIssueOwnerIntent`, lines 794-810).** The plan adds a strictness beyond the spec: `owner.id` must parse as a positive integer when `owner.kind === 'issue'` (`Number.isInteger(expected)` check on line 798-803). The spec at line 132 only says "must equal `Number(owner.id)`"; it does not forbid e.g. `'19.5'` or `'NaN'`. Either weaken the impl to match the spec (just compare `intent.issueNumber === Number(owner.id)`, letting NaN-vs-NaN naturally fail) or pin the stricter rule with a Task 4 test (e.g. `owner: { kind: 'issue', id: 'abc' }` → `invalid-intent`).

5. **important — Empty-string `owner.id` and zero-`issueNumber` corner cases are unspecified and untested (plan: Task 4; spec line 132).** `Number('')` is `0` and `Number.isInteger(0)` is `true`, so `owner: { kind: 'issue', id: '' }` with `intent.issueNumber: 0` would currently pass the validator. Not a blocker (zero is not a valid GitHub issue number, but the manager doesn't know about GitHub), but worth either documenting "any integer is acceptable" or adding a `> 0` guard with a pinning test.

6. **nit — `ownerKey` does not escape `'::'` in `owner.id` (plan: line 782-784).** `ownerKey({ kind: 'team', id: 'team::42' })` produces `'team::team::42'`, which collides with `ownerKey({ kind: 'team::team', id: '42' })`. The `WorktreeOwnerKind` union is closed to `'agent' | 'team' | 'issue'` so the second collision is impossible, but a future code path that synthesises owner ids from external input could trip the first. Trivial cost to harden (e.g. use a tuple key in a `Map<string, WorktreeId>` keyed by JSON or a non-string `Map`); since the spec is silent and the closed union mitigates, this is a nit.

7. **nit — Task 1 imports `WorktreeOwnerKind` in the test file but the spec at lines 50-52 lists `types.ts` exports without `WorktreeOwnerKind` explicitly (spec, top of Architecture section; plan Task 1 import block).** The spec mentions `WorktreeOwnerKind` in passing at line 72 but does not list it in the file's responsibility blurb. Plan correctly exports it. Cosmetic — worth a one-line spec edit if you sweep the spec while resolving the other findings.

8. **nit — `findOrphans` clock test (Task 6, first test, line 1223-1236) consumes `'2026-06-04T10:30:00.000Z'` for `scannedAt` and the plan asserts it; the second test (line 1238-1256) provides the same two timestamps but never asserts `scannedAt`.** Inconsistent strictness across closely-related tests. Suggest asserting `scannedAt.toISOString()` in every `findOrphans` test (cheap, prevents silent drift if someone refactors clock semantics).

9. **nit — The Task 8 engine-isolation regex `WORKTREES_IMPORT_REGEX` requires `[^'"]*\/worktrees` — i.e. a path separator before `worktrees` (plan: line 1647).** This means a bare-specifier `from 'worktrees/foo'` would not match. The repo uses relative imports only (verified by `ls src/workflow/` plus the existing runner-engine-isolation test, which uses the same shape), so this is a theoretical gap. The corresponding runner test has the identical pattern; consistency wins. Document the static-relative-import-only scope in a code comment in the test file.

10. **nit — Task 8 explicitly omits the "fail first" step (plan: lines 1666-1673) with sound reasoning (the assertion is an *absence* condition, faking an import to delete it would itself touch `src/workflow/`).** This is methodologically defensible and matches the precedent — but the heading still uses checkbox syntax that suggests TDD discipline. A one-line "(absence assertion; no red step possible)" comment in the task heading would prevent a future plan executor from being confused.

11. **nit — Task 4's `validateIssueOwnerIntent` produces an `invalid-intent` message containing `intent.issueNumber ?? 'missing'` (plan: line 808).** If `intent.issueNumber` is `0` (see Finding 5), the message will say `0`, not `missing` — which is correct, but the test on line 622-628 (`{ kind: 'issue', id: '19' }` with no `intent.issueNumber`) does not assert on `message`, only `code`. Future readers might wire up message-based assertions if the code is reused. Optional: add `expect(err.message).toMatch(/missing/)` to the first sub-case to pin it.

12. **nit — `release` test order in Task 5 places "propagates placement.remove errors unchanged" (line 1017-1041) *before* "allows acquire to reuse the same owner after release" (line 1043-1062), but the latter only succeeds if the prior `release({ id: record.id })` (without `deleteOnDisk`) actually removed the record (verified by the first `release` test, line 939).** The ordering is fine in practice — vitest does not interleave `it` blocks within a `describe` — but the dependency on prior assertions could be made more explicit. Optional cleanup; not a correctness issue.

13. **nit — Plan's "Task 9: Full suite green" Step 1 expected output says "the eight new tests files" but the plan actually adds four test files (worktree-manager-types, in-memory-worktree-placement, in-memory-worktree-manager, worktree-engine-isolation) (plan: line 1693).** Off-by-typo; reads as a small drafting error. Fix the count.

14. **nit — Mixed `npm test --` vs `npx vitest run` invocation across plans (plan: every task uses `npm test --`; issue-18 used `npx vitest run`).** Both work — `npm test` resolves to `vitest run` per `package.json` — but the inconsistency with the precedent is jarring. Pick one and explain in the "Notes for Plan Executors" or just leave it; not a correctness issue.

15. **nit — `WorktreeOwner` index uses a `Map<string, WorktreeId>` keyed by `ownerKey(owner)` but the spec at line 263 says "Updated atomically with `records` on acquire/release" (spec); plan honours this in `acquire` (lines 870-872) and `release` (lines 1183-1184), but the recovery branch at lines 837-840 ("Indexes diverged — treat as no existing record") silently mutates `ownerIndex` outside this atomicity guarantee.** Realistically `records`/`ownerIndex` cannot diverge in this single-threaded in-memory impl (Finding raises only the *defensive* code path that exists in case of a bug). Not blocking; just acknowledge the defensive branch is unreachable today and add a `// defensive: indexes diverged due to bug` comment for the next reader.

## Tests

The plan's TDD steps exercise the documented semantics well in most cases:

- **Idempotency** — `acquire` same-intent re-acquire is covered (Task 4 test 4, lines 643-670). `release` retry is covered (Task 5 test 4, lines 1001-1015). `reap` re-reap of `dangling-record` (Task 6 test 4, lines 1402-1418) and `untracked-location` (Task 6 test 2, lines 1349-1374) both covered. ✓
- **Error wrapping** — `placement-failed` wrapping (Task 4 test 7, lines 713-742) and `reap-failed` wrapping (Task 6 test 3, lines 1376-1400) both pin `code` and message-contains via `expect.stringContaining`. ✓
- **Orphan reconciliation order** — Task 6 test 4 (lines 1277-1315) pins both the dangling-before-untracked block ordering and the within-block sort (`alpha` before `zebra` for untracked-location; rA-before-rB by `createdAt` for dangling-record). The id-tiebreaker (when `createdAt` is identical) is not tested explicitly — the test gives distinct `createdAt` values. Add one test where two records share `createdAt` and assert id-lex order is used. ✓ with gap.
- **State mutation atomicity** — Task 4 test 7 (line 739-740) verifies that after a placement failure, `list()` is empty and `findByOwner` returns `null`. Good. ✓
- **Same-owner reuse after release** — Task 5 test 6 (lines 1043-1062). ✓

Gaps:

- **No test for the `id`-lex tiebreaker in dangling-record sort** (the inner branch of the sort comparator on plan line 1451-1452). With both records sharing `createdAt`, the order should fall back to id. Without a test, a future refactor that flips the comparator polarity would not be caught.
- **No test for `release({ id, deleteOnDisk: true })` on an unknown id** — the plan test on line 990-999 only asserts `release({ id: 'wt-does-not-exist' })` and `release({ id: 'wt-does-not-exist', deleteOnDisk: true })` both resolve to `undefined`, but does not verify that `placement.remove` is NOT called (since there's no record to look up). Add a `removeCalls.length === 0` assertion.
- **No test for `touch` on an unknown id with explicit `now`** — line 1148-1156 only covers the no-`now` case. Trivial to add.
- **No test for the spec's "if both sides specified one" `suggestedPath` semantics** — see Finding 1.

## Type consistency

- `WorktreeId` is consistently `string` (typed alias) across `types.ts`, `manager.ts`, `in-memory.ts`, all test files, and the barrel. ✓
- `AcquireInput`/`ReleaseInput` carry `now?: Date` in both `manager.ts` (lines 496-506) and tests/usage in `in-memory.ts` (`input.now ?? this.now()` on line 842 and 861). ✓
- `WorktreeRecord.issueNumber` is consistently `number | null` (never `undefined`) — types.ts (line 226), test fixtures (line 100, 113), and implementation (`owner.kind === 'issue' ? Number(owner.id) : intent.issueNumber ?? null` on line 866) all agree. ✓
- `WorktreeOrphan` discriminator uses `kind` consistently (`'dangling-record'` carries `record`; `'untracked-location'` carries `location`). ✓
- `WorktreeManagerErrorCode` union is identical in `types.ts` (lines 243-247), the structural test (line 177-188), and at every throw site in `in-memory.ts`. ✓
- `WorktreePlacement.remove` is keyed by `branchName` in `InMemoryWorktreePlacement` (plan line 414) but the type signature says `remove(location: WorktreeLocation)` — the `path` field is informational, not part of the lookup key. Task 2 test at line 354-360 ("matches remove by branchName, path is informational, not the key") pins this. ✓
- The `Date` types are consistent everywhere (never ISO strings, matching the spec note at line 133 and the precedent set by `Runner.status()` / `AgentAdapter.status()`). ✓
- `InMemoryWorktreeManagerOptions.now` is `() => Date` (factory) in `in-memory.ts` (line 771), while `AcquireInput.now` / `ReleaseInput.now` are `Date` (value). The split is correct: options-level `now` is the per-instance clock; per-call `now` is an explicit override. The plan's tests respect this distinction (e.g. Task 5 `touch` test line 1142 uses `manager.touch(id, new Date(...))`). ✓

## Methodology

- **TDD discipline is enforced in every implementation task (1–8).** Each adds a failing test first, prints the expected failure mode, then ships the minimum implementation. Task 8 (engine isolation) intentionally skips the red step with documented reasoning; this is consistent with how the issue-18 plan's equivalent test was handled.
- **No mid-task placeholders that survive the plan.** Task 4's `release`/`touch`/`findOrphans`/`reap` placeholders (lines 876-908) are explicitly replaced in Tasks 5 and 6. The chain of replacement is correct.
- **No circular task dependencies.** Task 1 (types) → Task 2 (placement, depends on types) → Task 3 (manager interface, depends on types) → Task 4 (in-memory.ts acquire, depends on all three) → Task 5 (modifies in-memory.ts) → Task 6 (modifies in-memory.ts) → Task 7 (barrel) → Task 8 (regression test) → Task 9 (gate).
- **Commit messages are descriptive but the trailer is missing (see Finding 2).**

STATUS=pass_with_findings
