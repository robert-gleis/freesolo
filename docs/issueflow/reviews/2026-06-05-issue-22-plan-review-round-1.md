# Plan Review — Issue #22 Factory Knowledge Base — Round 1

## Verdict
pass_with_findings

## Summary
The plan covers the spec's core deliverables — loader API, both spawn paths, starter files, no-cache disk reads, and injectable deps — with a sensible task breakdown that matches existing patterns in `start.ts` and `engine.ts`. Integration wiring (kernel first, knowledge appended outside `buildWorkflowKernel`) is correct. Two executability gaps will break compilation if followed literally, Task 2 inverts TDD for filesystem I/O, and a few formatting and test-harness details need tightening before implementation. No redesign is required.

## Findings

### Blockers

- **Task 4 spawn test destructures `agent` from `buildHarness`, but the harness does not return it.** The snippet uses `const { engine, agent } = buildHarness({ … })`, yet the current `buildHarness` in `tests/unit/workflow-engine.test.ts` only returns `{ engine, deps, events, policy, readState, writeState }`. Every existing spawn test creates `const agent = buildFakeAgent()` separately and passes it via overrides. As written, Task 4 Step 1 will not compile. Fix: either return `agent` from `buildHarness` when one is supplied, or follow the established pattern (`const agent = buildFakeAgent(); const { engine } = buildHarness({ agent, … })`).

- **Task 3 omits updating `createDeps` when `loadKnowledgeEntries` becomes a required `StartPlanDeps` field.** Step 3 adds `loadKnowledgeEntries` to `StartPlanDeps` and `defaultDeps` in `start.ts`, but `tests/integration/start-command.test.ts` defines its own `createDeps` helper that must satisfy the full interface. After Step 3, every existing test calling `createDeps()` without an override will fail TypeScript compilation until the helper gains a default stub (e.g. `loadKnowledgeEntries: async () => []`). The plan should call this out explicitly in Step 3 alongside the production wiring.

### Major findings

- **Task 2 skips the red step for filesystem behaviour (TDD inversion).** Task 1 Step 3 implements `loadKnowledgeEntries` before Task 2 writes filesystem tests; Task 2 Step 2 expects tests to pass immediately ("implementation from Task 1 already covers filesystem loading"). The plan's Self-Review acknowledges this as a "coverage-lock task," but a fresh implementer following TDD discipline will be confused. Prefer splitting Task 1 into pure helpers only (no `fs` imports) and moving `loadKnowledgeEntries` to Task 2 with a proper red/green cycle, or relabel Task 2 as "add regression tests" and drop the failing-test expectation language.

- **`formatKnowledgeSection` may omit the blank line between entry blocks that the spec example shows.** The spec renders each entry separated by a blank line before the next `###` heading. The plan joins `blocks` with a single `\n` via `Array.join('\n')`, producing `…content\n### Next` rather than `…content\n\n### Next`. Pure-formatting tests in Task 1 only assert `toContain` and will not catch this. Fix: join blocks with `\n\n` (e.g. `blocks.join('\n\n')` as the tail of the section array).

- **Task 4 `WorkflowEngineDeps` typing is inconsistent with Task 3's `StartPlanDeps` pattern.** Task 3 uses `loadKnowledgeEntries: typeof defaultLoadKnowledgeEntries` (clean, matches how other deps reference real implementations). Task 4 uses an inline `import('../knowledge/loader.js').KnowledgeEntry[]` return type on an optional field. Both work, but the inline import is harder to read and diverges from `start.ts` conventions. Align on `typeof defaultLoadKnowledgeEntries` and import `KnowledgeEntry` at the top of `engine.ts` if needed for tests.

- **Spec testing strategy names `tests/unit/start.test.ts`; plan uses integration tests only.** Acceptable — `tests/integration/start-command.test.ts` already hosts `createStartPlan` coverage with the `createDeps` harness, which is the right place for this assertion. Worth a one-line note in the plan that the spec's "unit" wording maps to the existing integration file so a reader does not go hunting for a non-existent `start.test.ts` plan section.

### Minor findings

- **No explicit test for an empty knowledge directory.** Spec: "A missing directory or empty directory yields zero entries." Task 2 covers missing (`ENOENT → []`) but not empty dir. Behaviour is implied by the filter loop; a one-liner test would lock the contract.

- **Print-only mode loads knowledge from `<worktrunk-checkout>` placeholder, not the source checkout.** `createStartPlan` sets `repoRoot = worktreePath`, which is `WORKTRUNK_CHECKOUT_PLACEHOLDER` in print-only mode. A real (non-stubbed) loader will return `[]` in print-only previews even when `.issueflow/knowledge/` exists in the main checkout. This mirrors pre-existing placeholder behaviour for artifacts/kernel paths and does not affect actual spawn, but operators using `--print-only` will not see starter knowledge in the preview command. Consider documenting as known v1 behaviour or loading from `rootDir` when the placeholder is active.

- **Task 1 exports `extractTitle` publicly though the spec Public API block does not list it.** Reasonable for unit testing; no functional issue. Optionally note it as a test helper export in a brief comment.

- **Task 2 append snippet duplicates top-level imports (`describe`, `expect`, `it`) already present from Task 1.** The plan says "merge the duplicate `describe` import" but the appended block re-imports several symbols. Consolidate imports in one edit step to avoid lint noise.

- **Engine enrichment test does not assert `loadKnowledgeEntries` was called with `workingDirectory`.** The test stubs the loader and checks enriched output, which is sufficient for wiring proof, but a `toHaveBeenCalledWith('/tmp/wt')` assertion would lock the spec's "load from `action.agent.workingDirectory`" contract against a future regression to `repo.rootDir` or similar.

- **Starter files (Task 5) have no automated smoke test.** Acceptable for v1 given Task 2's filesystem tests, but an optional end-to-end test loading the real `.issueflow/knowledge/` directory after Task 5 would catch shipping empty or malformed starter content.

- **Plan embeds commit steps per task.** Consistent with other IssueFlow plans; implementers should only commit when their workflow requires it (matches repo agent rules).

## Notes

- Loader API surface (`KnowledgeEntry`, `loadKnowledgeEntries`, `formatKnowledgeSection`, `appendKnowledgeToPrompt`) matches the spec verbatim; title regex (`/^#\s+(.+)$/m`) correctly implements "first `#` heading line."
- Both integration points match the spec: `appendKnowledgeToPrompt` after `buildWorkflowKernel` in `start.ts`, and enrichment before `agent.start` / `agent.send` in the engine spawn branch using `action.agent.workingDirectory`.
- Keeping knowledge outside `buildWorkflowKernel` preserves kernel test stability — good alignment with spec Non-Goals and "What is not changed."
- `buildHarness` + `buildFakeAgent` patterns in `workflow-engine.test.ts` and `createDeps` in `start-command.test.ts` are the right test vehicles; only the gaps above need patching.
- Task ordering (pure helpers → filesystem tests → start wiring → engine wiring → starter files) is logical and scoped commits are sensible.
- Self-Review correctly flags spec coverage and the Task 2 TDD inversion; promoting the `createDeps` and `buildHarness` gaps to explicit plan steps would make the plan fully executable on first pass.
