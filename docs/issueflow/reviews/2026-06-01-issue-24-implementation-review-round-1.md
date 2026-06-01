# Implementation Review — Issue #24 Workflow Engine — Round 1

## Verdict
pass

## Summary
The workflow engine implementation faithfully matches the spec across the policy, engine, and CLI layers. All four acceptance criteria are satisfied with corresponding test coverage. The six-code refusal taxonomy, decision-then-transition event ordering, ISSUEFLOW_ENGINE gating, exit-code mapping, and resumability-by-statelessness all line up with the design document.

## Test/Build Results
- npm test: pass (169/169 across 23 files; the new suites contribute `workflow-policy.test.ts` 4, `workflow-engine.test.ts` 15, `engine-command.test.ts` 12, and the new `engine` registration assertion inside `cli.test.ts`)
- npm run build: pass (`tsc -p tsconfig.json` exits 0 and `ensure-bin-executable.mjs` succeeds)

## Findings

No findings.

## Notes

Items I verified that are worth recording for the next reviewer so they do not relitigate them:

- **AC: single source of truth.** `engine.tick` is the only production caller of `writeState` outside of `src/commands/state.ts`, and that surface is itself gated by `ISSUEFLOW_ENGINE=1` (see `src/commands/state.ts:130`). The new engine CLI command (`src/commands/engine.ts:130`) uses the same gate, so both write paths agree on the engine-only contract.
- **AC: resume after restart.** The engine holds no per-tick state on disk; `createWorkflowEngine` only allocates a subscriber `Set` in-memory (`src/workflow/engine.ts:62-64`). Every `tick` re-reads from `readState`, so a fresh process resumes by calling `tick` again. The CLI builds a fresh engine per invocation (`src/commands/engine.ts:44`), which also matches the spec's "stateless between calls" framing.
- **AC: events for every decision and transition.** `emit({ kind: 'decision', ... })` runs unconditionally on every refusal path (via `refuse(...)`) and on the policy-output path (`src/workflow/engine.ts:129`); `transition` events fire only after `writeState` resolves (`src/workflow/engine.ts:150` and `:194`). The ordering decision-before-transition is structurally guaranteed by the code, and `workflow-engine.test.ts` asserts the exact sequence with `events.map((event) => event.kind)` ordering for both transition and spawn paths.
- **AC: refuses invalid states.** All six refusal codes (`no-state`, `malformed-state`, `terminal-state`, `invalid-transition`, `no-agent-adapter`, `policy-refused`) are implemented with the spec's exact wording, and each is covered by a dedicated test in either `workflow-engine.test.ts` or `engine-command.test.ts` (the latter also locks the exit-code mapping `2 / 2 / 2 / 1 / 1 / 4` from the spec table).
- **Test harness fidelity.** `buildHarness` in `workflow-engine.test.ts` returns `policy`/`readState`/`writeState` spies that are read back off `deps` after the override merge, so the spies in `harness.*` are guaranteed to be the same instances the engine receives. Overriding any of them in a single test (as several do) correctly replaces both the engine's reference and the harness's reference. No stale-closure trap here.
- **`tick` never throws for #17 typed errors.** `MultipleStateLabelsError` and `InvalidStateLabelError` are caught around `readState` (`src/workflow/engine.ts:104-112`); `InvalidTransitionError` is caught around both `writeState` call sites (`:138` and `:182`). Adapter errors during `start`/`send` deliberately propagate, which is documented in the engine and exercised by the "lets adapter errors during start propagate" test.
- **CLI stderr error wrapping.** The two `error wrapping` tests cover both unexpected throws from `resolveRepoRef` (e.g., not in a git repo) and unexpected throws from `tick` itself (e.g., adapter failure on spawn), so the CLI never leaks raw stacks; both return exit 1 with a clean message, matching the parallel construction in `state.ts`.
- **Style consistency.** `engine.ts` mirrors `state.ts` line-for-line in shape — same `WriteChannel`, same `withCommanderErrorHandling`, same default-deps factory, same `parseIssueNumber`. The duplication is called out in the plan's Accepted Trade-offs section.
- **Spec/CLI wording divergence.** The CLI stderr format (`engine refused (<code>): <reason>`) differs from the spec's illustrative `triaged refused: no-state`, but the spec marks its example as illustrative ("e.g.") and the plan explicitly accepts the implemented format. Tests assert via substring containment so the contract is well-defined.
