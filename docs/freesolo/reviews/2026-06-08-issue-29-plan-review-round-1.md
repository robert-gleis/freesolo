# Plan Review — Issue #29, Round 1

## Status
block

## Summary

The plan is well-structured at the architectural level: the file layout matches the spec exactly, the self-review table maps every acceptance criterion to a task, and Tasks 1 and 2-Step-1 demonstrate what full TDD discipline looks like. However the plan breaks down from Task 2 Step 3 onwards. Five of the six tasks have placeholder violations — either the test step contains only bullet-point descriptions instead of concrete runnable code, or the implementation step is prose instead of TypeScript. An agentic worker following this plan verbatim would be forced to invent all implementation details for `verdict-store.ts`, `gate.ts` (command), `pr.ts`, and their test files. Additionally, `GateCommandDeps` is missing `resolveRepoRoot`, a dependency the gate command demonstrably needs to call `loadLatestRun` and `writeGateVerdictRecord`. These issues must be fixed before the plan is handed to an implementing agent.

## Findings

1. **major — Task 2 Step 3 (`verdict-store.ts` implementation) is prose-only.** The step reads: _"Implement `VERDICT_LABEL_PREFIX`, `VerdictStatus`, `GateVerdictRecord`, `MultipleVerdictLabelsError`, `readVerdict`, `writeVerdict` (creates labels on demand, swaps atomically), `getGateVerdictPath` via `git rev-parse --git-path …`, `writeGateVerdictRecord`, `readGateVerdictRecord`. Mirror `state-store.ts` patterns…"_ This is a list of names and intentions, not code. `verdict-store.ts` is the second-most complex file in this issue (seven exported symbols, `gh` injection, label swap, filesystem roundtrip via git-path). An agent instructed to "mirror `state-store.ts`" must infer all call shapes, error handling patterns, and `GhRunner`-injection wiring without a single concrete line to copy. Provide the full TypeScript implementation block, as Task 1 Step 3 does.

2. **major — Tasks 3 and 4 test steps (Steps 1) are bullet-point prose, not code.** Task 3 Step 1 lists five test cases as dash items; Task 4 Step 1 lists six. Neither provides `describe` / `it` blocks, stub shapes, import paths, or assertion values. The implementing agent cannot run a red test without writing these from scratch, which breaks the red-green guarantee the plan promises. Provide full `tests/unit/gate-command.test.ts` and `tests/unit/pr-command.test.ts` code, mirroring the completeness of `tests/unit/verdict-store.test.ts`.

3. **major — Tasks 3 and 4 implementation steps (Steps 3) are prose-only.** Task 3 Step 3 gives a bulleted description of `gateEvaluateAction` logic; Task 4 Step 3 gives one-line descriptions of `assertPrGate`, `prCreateAction`, and `registerPrCommands`. Neither supplies the TypeScript that would make the preceding tests go green. This is the defining placeholder violation the review criteria flags. Both steps must be replaced with complete implementation blocks.

4. **major — `GateCommandDeps` is missing `resolveRepoRoot`.** The gate command needs two distinct resolutions: `RepoRef` (owner/repo strings, for `readState` / `writeState` / `readVerdict` / `writeVerdict`) and `repoRoot` (absolute path string, for `loadLatestRun` and `writeGateVerdictRecord`). Task 3 Step 3 lists `resolveRepoRef` in `GateCommandDeps` but omits `resolveRepoRoot`. The existing `defaultResolveRepoRef` in `src/commands/state.ts` returns only `RepoRef`; `repoRoot` is computed internally and discarded. `verify.ts` solves the same two-resolution problem by keeping `resolveRepoRoot` and `resolveRepoRef` as separate injectable deps. The gate command must follow the same pattern. Without `resolveRepoRoot` in the deps interface, the implementation either calls it non-injectably (untestable) or the integration test cannot exercise error paths. Add `resolveRepoRoot: (cwd: string) => Promise<string>` to `GateCommandDeps`.

5. **minor — Task 5 Step 1 (CLI test additions) is prose-only.** The step asserts two things to check (`gate evaluate --issue` registered, `pr create --print-only --issue` registered) but provides no `it` blocks or import lines. Existing `cli.test.ts` has a clear established pattern; provide the two concrete test additions so the red-green cycle is mechanically follow-able.

6. **minor — Task 6 (integration test) is prose-only throughout.** The entire step 1 is a paragraph describing fixture setup and three scenario beats. The plan for issue #20 (the predecessor integration test) provides a full `describe` block with typed imports and filesystem helpers. Provide equivalent concrete test code for `tests/integration/gate-pr-command.test.ts`.

7. **minor — `--issue` option mandatoriness is unspecified for both gate and pr commands.** The spec says step 1 of gate evaluate should "resolve via `resolveIssueNumber` (override → session → branch)". `resolveIssueNumber` accepts an optional override and falls back to session/branch — implying `--issue` is optional, matching `verify`'s behaviour. Yet `state transition --issue` is mandatory (`.makeOptionMandatory()`). The plan says "adds `gate evaluate --issue <n>`" without indicating required vs optional. Clarify, and ensure the decision is reflected in both the implementation and the CLI test assertion.

8. **minor — `MultipleVerdictLabelsError` exit-code path not covered in Task 4 tests.** The spec's error table assigns exit code `4` to `MultipleVerdictLabelsError`. If `readVerdict` throws inside `prCreateAction`, the command must map this to exit `4` (matching `state.ts`'s `withCommanderErrorHandling`). Task 4's test list does not include this path. Add it so the contract is pinned.

9. **nit — `VerdictStatus` declared in the self-review table but never referenced in any test or implementation snippet.** The self-review table footer says "All types named consistently (`GateEvaluation`, `GateVerdictRecord`, `VerdictStatus`)." `VerdictStatus` is not imported or used in the Task 2 test code (which passes `'pass'` and `'fail'` as string literals). If `VerdictStatus` is a named export, show at least one import to lock it in.

10. **nit — Task 3 Step 3 bullet list uses "Resolve repo + issue" without specifying the injected dep names.** Contrast with the way `GateCommandDeps` fields are named elsewhere. Not a blocker but creates ambiguity for the implementing agent about whether to use `resolveRepoRef`, `resolveRepoRoot`, or both when writing the action body.

## What looks good

- Every acceptance criterion from the spec is mapped to a task in the self-review table, and spot-checking confirms the mappings hold.
- Tasks 1 and 2 Step 1 demonstrate exactly the standard required: concrete, copy-runnable TypeScript with precise import paths (`../../src/verification/gate.js`), typed fixture factories, and exact `expect` assertions. If that quality were applied to all tasks the plan would pass.
- Type names (`GateEvaluation`, `GateOutcome`, `GateVerdictRecord`, `MultipleVerdictLabelsError`) match the spec character-for-character and mirror the naming conventions of the existing `state-store.ts` (`MultipleStateLabelsError`, `STATE_LABEL_PREFIX`).
- The `fakeGh` helper in Task 2 correctly mirrors the `GhRunner` injection pattern from `state-store.ts`, importing the type from the right path and returning `{ stdout, stderr, exitCode }`.
- The `gate-verdict.json` roundtrip test (Task 2 Step 1, last case) correctly uses `fs.mkdtemp` + `afterEach` cleanup, matching the integration-test hygiene in issue #20's plan.
- Task 7 (full suite + build) is present and correct — the final gate before declaring the implementation done.
- No open decisions remain in the spec; the plan correctly inherits that clean state.

STATUS=block
