# Plan Review — Issue #33, Round 2

## Status
pass

## Round 1 follow-up

1. **stop() from idle no-op semantics (major)** — addressed. Task 4's `stop()` body is now `if (this.state === 'idle') return; this.state = 'stopped';`, and the "is a no-op when never started" test asserts `status.state === 'idle'`. Matches the spec contract.
2. **String-match semantics undocumented (minor)** — addressed. Spec line 113 now documents "a string `match` is exact case-sensitive equality, use a RegExp for substring or case-insensitive matching", and Task 5's helper has an identical inline comment.
3. **Tests directory deviation (minor)** — addressed. Plan now puts files at `tests/unit/agent-adapter-types.test.ts` and `tests/unit/scripted-agent-adapter.test.ts`, matching the flat layout used by every other test in the repo. Import paths updated to `../../src/...` accordingly.
4. **`initialInstructions` not exercised (minor)** — addressed. Task 1 adds the test "AgentStartInput preserves initialInstructions on the structural type" which would break if the field were removed.
5. **State union not pinned at runtime (minor)** — addressed. Task 1 adds the test "pins the AgentState union shape" with the full 6-value list; if any state were dropped from the union, the assignment would fail to typecheck.
6. **Self-review row wording for AgentScript/ScriptStep (nit)** — addressed. The row now reads just "Task 2".
7. **lastActivityAt monotonicity assertion (nit)** — partially addressed. The test now also asserts `after >= startedAt`, which is a stronger statement than the original. Not strictly comparing `after > before` but reasonable.

## New findings

None blocking. Minor observations:

1. **nit — `stop()` from `stopped` re-assigns `stopped` rather than truly short-circuiting (plan: Task 4, Step 3).** The early-return only checks `idle`. Calling `stop()` on a `stopped` adapter falls through and re-assigns `this.state = 'stopped'`. Observable behavior is still a no-op and the test "is idempotent when already stopped" passes. If you want to mirror the spec wording ("From `idle` or `stopped`, resolves immediately as a no-op") more literally, change the guard to `if (this.state === 'idle' || this.state === 'stopped') return;`. Pure polish.

2. **nit — Task 1 union-pinning test runtime assertion is weak (plan: Task 1, Step 1 third test).** `expect(_allStates).toHaveLength(6)` only catches a length regression; the real safety net is the compile-time assignment `const _allStates: AgentState[] = [...]`. That is sufficient — the runtime check just makes vitest report it as a passing assertion. Worth noting only because someone editing the file later might think the runtime check is doing the work. No action required.

3. **nit — `AgentAdapterError` "supports every documented error code" test does not catch additions (plan: Task 1, Step 1 second describe).** Iterating over a hardcoded list of four codes proves each is constructible but does not pin the `AgentAdapterErrorCode` union to exactly those four — a new code added to the type would not fail this test. Could be tightened by typing the array as `AgentAdapterErrorCode[]` so dropping a code would break it (additions still wouldn't, which is fine). Optional.

## What looks good

- All round-1 findings are addressed cleanly with no regressions.
- Test counts in each task's "Expected: PASS, N tests" line match the cumulative count (1 → 3 → 6 → 9 → 13 → 15), and Task 8's gate of "5 + 15 tests" is consistent.
- Task ordering still satisfies strict TDD: every red step has a concrete expected failure (`start-failed: not implemented yet`, `stop-failed: not implemented yet`, etc.) traceable to the Task 2 skeleton.
- Task 7's claim that "Task 3's `start` already clears `lastActivityAt`" is verified — Task 3's `start` body explicitly sets `this.lastActivityAt = undefined`, so the reuse test will pass without further code changes.
- The start→stop→start cycle in Task 7 is consistent with Task 3's precondition (`state !== 'idle' && state !== 'stopped'` → throw), which correctly allows the second `start` from `stopped`.
- File layout, type names, error codes, state names, and method signatures match the spec character-for-character.
- Spec's intentional simplification (reference adapter never observably sits in `starting`/`stopping`/`error`) is still documented in the self-review and is consistent with the test suite.
- Commit boundaries and trailers are unchanged from round 1 and still sensible.
