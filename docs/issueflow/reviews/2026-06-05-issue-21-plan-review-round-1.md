# Plan Review — Issue #21 — Round 1

**Verdict:** pass_with_findings

## Findings

### important — Integration test helper not updated for new `listAdrs` dep
- **Location:** Task 5; `tests/integration/start-command.test.ts` (`createDeps`, lines 26–60)
- **What's wrong:** Adding `listAdrs` as a required field on `StartPlanDeps` will fail TypeScript compilation for the integration suite. The plan only adds `listAdrs` to the new `start-adrs.test.ts` helper and `defaultDeps`; it never updates `createDeps` in `tests/integration/start-command.test.ts`, which constructs a full `StartPlanDeps` object.
- **What to change:** Add `listAdrs: async () => []` (or a real stub) to `createDeps` in `tests/integration/start-command.test.ts`, or document it as an explicit sub-step in Task 5 before the Task 5 commit. Task 7 full-suite verification will catch this, but the plan should name the file so implementers don't discover it only at the end.

### important — `buildWorkflowKernel` test fixture omitted from Task 4 updates
- **Location:** Task 4, step 1 (“Also add `adrs: []` to the existing `buildIssuePacket` test fixture”)
- **What's wrong:** `WorkflowKernelInput` gains a required `adrs` field. `tests/unit/workflow.test.ts` has two fixtures — `buildIssuePacket` (line 7) and `buildWorkflowKernel` (line 39). The plan only instructs updating the packet fixture. The kernel fixture will fail to compile once Task 4 lands.
- **What to change:** Explicitly add `adrs: []` to the `buildWorkflowKernel` test input in the same step, or note “both fixtures in `workflow.test.ts`”.

### important — Task 4 commit leaves `start.ts` uncompilable until Task 5
- **Location:** Task 4 step 5 (commit) vs Task 5 (wire `start.ts`)
- **What's wrong:** Task 4 makes `adrs` required on `WorkflowKernelInput` and commits, but `src/commands/start.ts` builds `workflowInput` without `adrs` until Task 5. `npm run build` after the Task 4 commit will fail. Per-task commits are fine, but the plan’s intermediate commit boundary breaks the build.
- **What to change:** Either merge Tasks 4 and 5 into one commit, add a minimal `adrs: []` stub to `start.ts` in Task 4 (then wire real `listAdrs` in Task 5), or defer the Task 4 commit until Task 5 is complete.

### minor — Spec-default `adrs` vs required field
- **Location:** Task 4; spec “Spawn-time injection” (`WorkflowKernelInput` with default `[]`)
- **What's wrong:** Spec allows call sites to omit `adrs` (default empty). Plan makes `adrs: AdrRecord[]` required, increasing churn at every `WorkflowKernelInput` construction site. Not wrong, but diverges from spec wording and contributed to the missed integration-test update.
- **What to change:** Prefer `adrs?: AdrRecord[]` with `input.adrs ?? []` inside `buildIssuePacket`, or keep required but audit all call sites (including integration tests) in one checklist step.

### minor — Spec error-handling tests not planned
- **Location:** Task 2; spec “Errors” and “Testing” sections
- **What's wrong:** Spec calls out: malformed filenames (e.g. `foo.md`) silently ignored, duplicate numbers sorted stably by filename, and non-`ENOENT` FS errors propagated. Task 2 tests cover ordering, exclusion of format docs, and missing directory, but not these edge cases.
- **What to change:** Optional — add one `listAdrs` test with `foo.md` present (expect ignore) and one duplicate-number sort assertion. Skip permission-error propagation unless the project routinely tests `EACCES`; spec lists it but it is low value for v1.

### minor — `listAdrs` call site should name `worktreePath` explicitly
- **Location:** Task 5, step 4 (“Before building `workflowInput`, add: `const adrs = await deps.listAdrs(repoRoot)`”)
- **What's wrong:** In `start.ts`, `repoRoot` is assigned from `worktreePath` (line 333), not from `rootDir` (the source checkout). The step is correct if placed after that assignment, but “before building `workflowInput`” is ambiguous and could lead to scanning the wrong directory.
- **What to change:** Clarify: call `listAdrs` after `const repoRoot = worktreePath`, using the worktree path (same value passed as `repoRoot` in `workflowInput`).
