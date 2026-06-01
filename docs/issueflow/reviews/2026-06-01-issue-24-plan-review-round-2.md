# Plan Review — Issue #24 Workflow Engine — Round 2

## Verdict
pass_with_findings

## Summary
The plan is well-structured, type-coherent across tasks, and covers every spec requirement (goals, public API, all six refusal codes, default policy, event system, persistence/resumability, CLI surface, and the full testing matrix). TDD discipline is generally crisp — red-step expectations are explicit and Task 4 / Task 6 add new tests that genuinely fail before the implementation step. A few minor issues remain: a transient bug shape in the Task 2 fall-through return for non-wait actions, a small stylistic divergence from `state.ts`, and a couple of test-message expectations that warrant a sanity check.

## Findings

### minor — Task 2 Step 3 returns a misleading `toState` for non-wait actions before later tasks replace the branch
Location: `docs/issueflow/plans/2026-06-01-issue-24-plan.md` Task 2 Step 3, the final block of `tick`:
```ts
const action = deps.policy({ state: current, issueNumber, repo });
emit({ kind: 'decision', ... });
return {
  issueNumber,
  fromState: current,
  toState: current,
  action
};
```
This is intentional scaffolding ("Stages beyond the state refusals are added in later tasks"), but it returns `toState: current` and no `refused` field for **any** non-wait/non-refusal action, including `transition` and `spawn`. After Task 2 completes, the suite only runs Task 2's own tests — which never inject a transition/spawn action — so it passes green, but the contract is silently wrong in the intermediate commit. Two practical impacts:

1. If a curious engineer runs the broader test suite after Task 2 (only Task 1 + Task 2 tests should exist at that point, so this is mostly hypothetical), the contract violation is invisible.
2. The Task 3 "wait" test asserts `toState: 'implementing'` (== `current`), which masks the asymmetry. Consider replacing the placeholder with an explicit `refused: { code: 'policy-refused', reason: 'unhandled action kind: <kind>' }` return so each intermediate commit is internally consistent (Task 4 already migrates `transition` away, Task 6 migrates `spawn`, Task 7 finalises `refuse`).

This is purely a hygiene/sequencing nit; functionality after Task 7 is correct.

### minor — `withCommanderErrorHandling` signature drifts from `state.ts`
Location: `docs/issueflow/plans/2026-06-01-issue-24-plan.md` Task 8 Step 4, in `src/commands/engine.ts`:
```ts
function withCommanderErrorHandling(
  deps: EngineCommandDeps,
  action: () => Promise<void>
): Promise<void> { ... }
```
`src/commands/state.ts` has the same-named helper with signature `(command, deps, action)`. The plan's version drops the `command` argument (state.ts already underscores it). The new shape is arguably cleaner, but the divergence will surprise a reader scanning both commands side-by-side. Either keep parity with state.ts, or drop the unused argument in both files in a follow-up. Not a blocker.

### minor — CLI test "exits 4 for malformed-state refusals" uses a literal that won't match the real engine reason
Location: `docs/issueflow/plans/2026-06-01-issue-24-plan.md` Task 8 Step 2, in `tests/unit/engine-command.test.ts`:
```ts
refused: { code: 'malformed-state', reason: 'multiple workflow state labels' }
...
expect(io.stderr.join('')).toContain('multiple workflow state labels');
```
The reason is the test fixture's literal, not the engine's actual reason (which is the underlying `MultipleStateLabelsError.message`, e.g. `Issue #24 has multiple workflow state labels: triaged, planned. Repair manually before retrying.`). The test still passes because the CLI prints whatever the fixture supplies, but the substring chosen happens to also appear in the real error — so it's lucky rather than designed. The choice is fine; just call this out so the implementer doesn't mistake it for an end-to-end assertion.

### minor — `formatSuccess` spawn branch is unreachable through the default CLI but compiled in
Location: `docs/issueflow/plans/2026-06-01-issue-24-plan.md` Task 8 Step 4, `formatSuccess`:
```ts
if (result.action.kind === 'spawn') {
  return `${result.fromState} -> ${result.toState} (spawn -> ${result.action.nextState})\n`;
}
```
The CLI default deps never wire an agent adapter, so a `spawn` action always lands in the `no-agent-adapter` refusal path; the success branch above is dead code on the default invocation. That's defensive (a future runner ticket may inject an adapter), so it's worth keeping — but the plan should call out that the spawn-success path is not exercised by any CLI test, since the CLI suite has no test that supplies a tick result whose action is `spawn` without `refused`. If you want belt-and-braces, add one test that injects a successful spawn `TickResult` and asserts the formatted line.

### minor — Plan's note on "briefly-unused imports" presumes lint posture
Location: `docs/issueflow/plans/2026-06-01-issue-24-plan.md` Task 2 Step 1 note:
> The project's vitest/TypeScript configuration tolerates briefly-unused imports during the red phase of TDD; do not add a placeholder test to "consume" them.

Verified against `tsconfig.json`: `noUnusedLocals`/`noUnusedParameters` are not set and there is no ESLint configuration in the repo, so this is accurate today. Worth a one-line acknowledgment that if a future ADR adds either flag, the imports will need to migrate to per-task additions. Not a blocker.

## Notes

- **Strong points**: the explicit table mapping refusal codes to exit codes is great; both the engine's typed-error contract (`tick` swallows the three #17/#33 typed errors and propagates everything else) and the `formatSuccess`/`formatRefusal` split are clean. The `buildHarness` factory mirrors `state-command.test.ts` style faithfully.
- **TDD discipline**: red phases are clearly labelled with the expected failure mode (e.g. "cannot resolve `../../src/workflow/engine.js`" for Task 2 Step 2; "writeState is never called and no transition event is emitted" for Task 4 Step 2). Tasks 3 and 5 explicitly note that the prior task's implementation already satisfies the new tests and frame them as contract locks — correct framing.
- **Engine ordering**: spawn semantics (`start` → `send` → `writeState`) match the spec exactly, and Task 6's "adapter errors propagate" test correctly locks the "engine is one-shot, no retry" contract from the spec.
- **Spec coverage check**: every refusal code listed in the spec has a dedicated test path. Every CLI exit-code from the spec's CLI Surface section appears in `REFUSAL_EXIT_CODES` and is covered by a CLI test. Default policy table matches the spec's table row-for-row, including the test that locks `merged → closed`.
- **No blockers**: a fresh engineer can follow this plan end-to-end without guessing; types compose; imports resolve; tests demonstrably fail before their implementation step. Findings are quality-of-life polish, not correctness gaps.
