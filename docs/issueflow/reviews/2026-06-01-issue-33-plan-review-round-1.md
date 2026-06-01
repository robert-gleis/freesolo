# Plan Review — Issue #33, Round 1

## Status
pass_with_findings

## Summary
The plan is tight, well-ordered, and faithfully implements the spec's interface, error type, reference adapter, and test list. Tasks follow strict red/green TDD with concrete code (no TBDs), state names match the spec exactly, and the file layout (`src/agents/` + barrel) matches the spec verbatim. The main concerns are (a) a likely spec-contradiction in how `stop()` is implemented for an `idle` adapter — the spec says "no-op from idle" but the plan unconditionally transitions to `stopped`; (b) string-match semantics in `ScriptStep` are silently picked as strict equality without being stated in either the spec or plan; and (c) the new tests live in a `tests/unit/agents/` subdirectory while every existing test in the repo sits flat under `tests/unit/`. None are blockers, but the first deserves either a spec amendment or a behavior change before code lands.

## Findings

1. **major — `stop()` on a never-started adapter changes state from `idle` to `stopped` (plan: Task 4, Step 1 + Step 3 of `src/agents/scripted.ts`).** The spec's `stop()` contract says "From `idle` or `stopped`, resolves immediately as a no-op." The plan implements `async stop() { this.state = 'stopped' }` unconditionally, and the test "is a no-op when never started" asserts `status.state === 'stopped'` after `stop()` on a fresh adapter. That contradicts the spec's no-op semantics (the natural reading of "no-op from `idle`" is "state remains `idle`"). Two options to resolve before implementation:
   - **Tighten the spec**: clarify that "no-op" means "does nothing observable" but `stop()` always ends in `stopped`. Then keep the plan as-is.
   - **Tighten the plan**: change `stop()` to `if (this.state === 'idle') return; this.state = 'stopped';` and update the Task 4 test to assert `status.state === 'idle'` after `stop()` on a never-started adapter.
   Either is fine; the plan and spec just need to agree.

2. **minor — Strict-equality semantics for `match: string` are an undocumented design choice (plan: Task 5, Step 3 helper `matches`).** The spec defines `match: string | RegExp` but never says whether a string `match` is exact, substring, prefix, or case-insensitive. The plan silently picks `match === input` (exact, case-sensitive) and the test "first matching step (string match)" only exercises an input that exactly equals the match. Real callers will be surprised either way. Recommend either (a) adding a one-line note in the spec ("string `match` is exact equality") and a plan code-comment, or (b) using `input.includes(match)` if substring semantics are intended. Pick one; don't leave it implicit.

3. **minor — Tests use a `tests/unit/agents/` subdirectory while every other test lives flat under `tests/unit/` (plan: File Structure table).** Existing files are all `tests/unit/<name>.test.ts` (e.g. `adapters.test.ts`, `host-asset.test.ts`, `slug.test.ts`). The plan introduces `tests/unit/agents/types.test.ts` and `tests/unit/agents/scripted.test.ts`. Vitest discovers them either way and the relative import paths in the plan account for the extra depth (three `..`s), but this is a deviation from established repo convention. Either flatten to `tests/unit/agent-types.test.ts` + `tests/unit/scripted-agent.test.ts`, or accept the subdirectory and call it out as a deliberate shift in convention.

4. **minor — `AgentStartInput.initialInstructions` is declared but the reference adapter never reads it (plan: Task 1 types.ts; Task 3 `start` body).** The spec includes `initialInstructions?: string` in `AgentStartInput`. `ScriptedAgentAdapter.start` takes it as `_input` and ignores the field entirely. That is consistent with the spec's "intentionally trivial" framing but means there is no test confirming the field reaches an adapter at all (a future implementer copying this skeleton could drop the field accidentally). Consider a one-line test that asserts the type accepts `initialInstructions` so a refactor that removes the field would break a test rather than silently regress. (This is a nicety; the existing `types.test.ts` already pins the rest of the contract.)

5. **minor — `error` / `starting` / `stopping` states are declared but unreachable in the reference adapter, and the plan does not add a runtime test pinning them as legal values (plan: Task 1 types.ts; self-review note at the end).** The plan's self-review correctly explains this is intentional — real adapters will exercise those states. But the `types.test.ts` does not enumerate the state union, so a future edit that drops `'starting'` from `AgentState` will compile against `ScriptedAgentAdapter` and still pass the suite. A cheap one-line type-level assertion (e.g. `const _states: AgentState[] = ['idle', 'starting', 'running', 'stopping', 'stopped', 'error'];`) inside the existing `types.test.ts` would lock the union without adding a new test file.

6. **nit — Self-review table cites Task 2 for `AgentScript` / `ScriptStep` types (plan: Self-Review row "AgentScript and ScriptStep types").** They are actually first defined inline in Task 2's `src/agents/scripted.ts`. Wording is fine but the column says "(skeleton), Task 5 (used)" which is slightly misleading — the types are fully defined in Task 2; Task 5 just consumes them. Pure documentation cleanup.

7. **nit — Task 5 test "updates lastActivityAt on successful send" asserts `before` is `undefined` and `after` is a `Date` instance, but does not assert `after > before` (plan: Task 5, Step 1 third test).** With monotonic clocks this is overkill, but the natural assertion ("activity timestamp moved forward across the call") is stronger. Optional polish.

## What looks good

- Every spec requirement and acceptance criterion is mapped to a numbered task in the self-review table; spot-checking each row, the mapping holds.
- Strict TDD discipline: each task is a red/green cycle with a concrete failing-test command, expected failure message, then the minimum implementation to pass.
- No TBDs, no "implement later" placeholders, no scaffold-only steps — every code block is complete and copy-runnable.
- State names, error codes, type names, and method signatures match the spec character-for-character; the relative import paths (`'../../../src/agents/types.js'`) correctly account for the extra directory depth.
- File layout (`src/agents/{types,scripted,index}.ts` + barrel re-exports) matches the spec verbatim, and the plan respects the spec's separation between `src/adapters/` (host launchers) and `src/agents/` (agent runtimes).
- Commit boundaries are sensibly tight (one per task), each with a descriptive subject line and the required Co-Authored-By trailer.
- Task 8 includes a full `npm test` and `npm run build` gate before closing out, which will catch any TypeScript regressions against the existing suite.

STATUS=pass_with_findings