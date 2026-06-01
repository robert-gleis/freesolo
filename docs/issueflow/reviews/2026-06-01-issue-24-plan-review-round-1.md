# Plan Review — Issue #24 Workflow Engine — Round 1

## Verdict
pass_with_findings

## Summary
The plan covers every spec requirement (policy, engine, refusal codes, events, CLI, persistence-by-statelessness) with concrete TDD-shaped tasks and the type/control-flow design is broadly correct against `state-machine.ts`, `state-store.ts`, and the `AgentAdapter` interface. There are, however, two real correctness bugs (a mid-file `import` and a placeholder test that exists only to silence an unused-import warning) plus several executability/consistency issues a fresh engineer will trip over, so it should not land as-is but does not need redesign.

## Findings

### Blockers

- **major — Task 6 / `tests/unit/workflow-engine.test.ts` step 1: `import` placed in the middle of the test file.** Step 1 says "Append to `tests/unit/workflow-engine.test.ts`" and the appended snippet begins with `import type { AgentAdapter, AgentResponse, AgentStatus } from '../../src/agents/index.js';`. ES module / TypeScript imports must appear before any non-import statement. As literally written, the file will not parse after Task 6 is applied (Task 2 already wrote `describe` blocks above this insertion point). Fix: move these imports into the top-of-file import block introduced in Task 2, or restructure Task 6 to edit imports first.

### Major findings

- **major — Task 2, Step 1 placeholder test "keeps `InvalidTransitionError` importable".** This test exists solely to silence an unused-import lint warning until Task 4 needs the symbol. It exercises nothing about the engine and will pollute the suite with a no-op assertion that survives the eventual refactor (nothing in later tasks removes it). The cleaner option is to defer the import until Task 4, or accept a temporary `// eslint-disable-next-line` while the symbol is unused. The current shape is a code smell that masks the real intent of the test file.

- **major — Task 8 CLI command lacks `withCommanderErrorHandling`-style wrapping (inconsistency with `src/commands/state.ts`).** The plan's `engine.ts` action handler does not wrap the `resolveRepoRef`/`tick` calls in any try/catch. Compare with `src/commands/state.ts` which routes every action through `withCommanderErrorHandling` so that unexpected throws print a clean stderr message and set exit code `1`. As written, a `resolveRepoRoot` failure ("issueflow must be started inside a git repository") will leak a raw stack from Commander's exit override path, breaking the convention the rest of the CLI established in #17. Either add equivalent wrapping or document a deliberate departure from the state-command shape.

- **major — Task 8 CLI test instructions for `tests/unit/cli.test.ts` are ambiguous.** Step 1 says "add the following describe block" but the snippet is a bare `it(...)` call. The existing file has a `describe('buildCli', …)` wrapping the other registration tests; the new test must be inserted inside that block (or rewritten as a sibling `describe`). A fresh engineer following the plan literally will produce a test outside any describe and lose suite grouping. State explicitly where the `it(...)` goes.

- **minor (verging on major) — Plan picks one side of a spec contradiction without flagging it.** The spec says in two places that "`tick` never throws" / "All paths return a `TickResult`", but then in Persistence & Resumability writes "If the engine crashes between `agent.start` and `writeState`, the next tick observes the still-old state and re-attempts." Task 6's test "lets adapter errors during start propagate (engine is one-shot, no retry)" picks the second reading. That is a defensible interpretation, but the spec also lists exactly six refusal codes and `agent.start` failures fit no listed code — so they have to escape. The plan should either (a) introduce a `agent-failed` refusal code and update the spec, or (b) include a one-line comment in `engine.ts` recording the deliberate choice. Right now the choice is buried in a test name and a future maintainer will read it as a bug.

### Minor findings

- **minor — `defaultPolicy` returns a confusing wait reason for `closed`.** The implementation falls through to `return { kind: 'wait', reason: \`agent owns work in state "${input.state}"\` };` so calling the policy with `state: 'closed'` produces `"agent owns work in state 'closed'"`, which is semantically wrong (no agent owns terminal work). The engine short-circuits before reaching policy for `closed`, so this is unreachable in practice, but Task 1's test "returns wait for the closed state too" exercises exactly this code path. Either short-circuit `closed` in the policy with a dedicated reason ("terminal state, engine should never have called the policy"), or weaken the test to not depend on the message.

- **minor — `buildHarness` pattern in `tests/unit/workflow-engine.test.ts` is unnecessarily indirect.** The harness stashes the constructed engine onto `deps.__engine` and exposes it via an external `engineFrom(deps)` helper. `tests/unit/state-command.test.ts` returns the constructed `program` directly from the harness; the same shape (return the engine from `buildHarness`) is cleaner, satisfies the same goal, and matches the existing convention. Recommend `return { engine, events, policy, readState, writeState };`.

- **minor — `WorkflowEngineDeps` does not document the `now` default behaviour in the public types section.** The plan adds `now?: () => Date` (good) but the spec's Public API block doesn't list it. The engine wires `deps.now ?? (() => new Date())`. Consider tightening the spec to mention the override in the types block; otherwise it looks like a hidden test-only knob.

- **minor — Task 6 "refuses with no-agent-adapter" test does not assert the decision event was emitted.** Spec says exactly one `decision` event must fire even on refusal. The test only checks `result.refused?.code` and that `writeState` was not called. Add `expect(harness.events.filter(e => e.kind === 'decision')).toHaveLength(1);` to lock the spec contract for this refusal path the same way `policy-refused` and `invalid-transition` already do.

- **minor — Spec line "exits 4 for `malformed-state` (mirrors the existing state-CLI behaviour)" — plan correctly maps to 4, but `MultipleStateLabelsError` is caught inside `tick`, not at the CLI layer.** The result is the same exit code, but it bypasses the existing `withCommanderErrorHandling` branch that pattern-matches the error class. If a future change ever lets a typed error escape `tick` again, the CLI will silently downgrade it to exit `1`. Worth a code comment in `engine.ts` ("typed state-store errors must be caught here; the CLI relies on TickResult.refused").

- **minor — CLI `formatSuccess` spawn branch uses a Unicode arrow (`→`) while the transition branch uses ASCII (`->`).** Spec example shows only `merged -> closed (transition)`; pick one convention. `->` is the better fit for terminal output (no Unicode surprises in CI logs).

- **minor — Plan asserts "total ≈ 162 tests" after Task 8.** Counts drift; tying the verification step to an exact number invites flakiness if a sibling PR adds a test. Replace with "`rtk npm test` exits 0" or "all suites green".

- **minor — Spec sample import line `import type { ..., WorkflowState } from './state-machine.js';` for `RepoRef` is wrong** (state-machine.ts does not export `RepoRef`). The plan's policy.ts correctly imports `RepoRef` from `./state-store.js`, so this is already corrected in the plan — flagged only so the spec gets updated alongside.

## Notes

- Tasks 1–7 are well-staged: each task has a clear red/green split, the file edits are tightly scoped, and the commits read sensibly. The progressive engine implementation (refusals → wait → transition → subscribers → spawn → policy-refuse → CLI) is exactly the layering I would have suggested.
- Good catch on the `invalid-transition` translation living inside `tick` rather than at the CLI: it keeps the engine's "tick never throws" contract honest for the typed errors that v1 promises to translate.
- The CLI exit-code table in Task 8 (`REFUSAL_EXIT_CODES`) is a much better shape than the open-coded switch I half-expected; it's directly auditable against the spec.
- The plan respects the existing `RepoRef`/`StateCommandDeps`/`registerStateCommands` shapes from #17. Naming (`EngineCommandDeps`, `registerEngineCommands`) is consistent with the established convention.
- Default policy table in the spec correctly matches the plan's implementation (only `merged → closed` auto-transitions; everything else waits).
