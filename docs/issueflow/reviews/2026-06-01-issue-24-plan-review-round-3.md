# Plan Review — Issue #24 Workflow Engine — Round 3

## Verdict
pass_with_findings

## Summary
The plan is comprehensive, internally consistent, and faithfully implements the spec. All six refusal codes, the spawn/transition/wait/policy-refuse action paths, the subscriber semantics, and the CLI gating and exit-code matrix are covered. A handful of minor concerns remain — chiefly that two tasks (3 and 5) don't actually produce a red test (they lock contracts already satisfied by Task 2's implementation), and a few small ergonomic and stylistic notes — none of which are blockers.

## Findings

### Minor — TDD red phase is absent for Tasks 3 and 5

- **Location:** `docs/issueflow/plans/2026-06-01-issue-24-plan.md` Task 3 (`Engine returns the policy's wait action`) and Task 5 (`Subscriber management`).
- **Issue:** Both tasks declare `Expected: PASS` at Step 2 — they verify the existing Task 2 implementation against new tests. Strict TDD would require the tests to fail first; here they cannot, because Task 2 already implements the behaviour they assert. The plan is transparent about this ("Task 2's engine already handles wait correctly; this task locks the contract with a test"), so it is closer to retroactive coverage than a TDD bug. Worth flagging in case the implementing agent treats the green outcome as evidence the test exercises something the engine could plausibly get wrong.
- **What to change:** Optional. Either acknowledge in the plan that these are coverage-locking tasks (already partially done) and accept they don't follow red-green-refactor, or fold their assertions into Task 2 so each Task obeys TDD discipline.

### Minor — Unused imports in `tests/unit/workflow-engine.test.ts` during Tasks 2–5

- **Location:** Task 2, Step 1 imports `InvalidTransitionError`, `AgentAdapter`, `AgentResponse`, `AgentStatus`. None of these symbols are referenced until Task 4 (`InvalidTransitionError`) and Task 6 (`AgentAdapter`/`AgentResponse`/`AgentStatus`).
- **Issue:** Verified `tsconfig.json` has no `noUnusedLocals` and `include: ["src/**/*.ts"]` (tests are not type-checked by `tsc -p tsconfig.json`). Vitest uses esbuild, which strips unused imports silently. So this does not break the build or tests today. The plan's own note acknowledges this and suggests an eslint-disable comment if a future lint pass enables `no-unused-vars`. Acceptable, but each new task introducing imports inside the body of the test file (rather than at the top) would be cleaner and avoid the brittleness if `noUnusedLocals` is ever enabled.
- **What to change:** Optional — move each import to the task that first needs it (Tasks 4 and 6) instead of hoisting everything up-front, OR keep the current shape and surface the rationale in a single line in the plan's File Structure section so a future ADR doesn't surprise an implementer mid-flight.

### Minor — `defaultEngine` is constructed at module-load time in `src/commands/engine.ts`

- **Location:** Task 8, `src/commands/engine.ts`, `const defaultEngine = createWorkflowEngine(defaultEngineDeps);` near the top of the file.
- **Issue:** Importing `src/commands/engine.ts` (e.g., from `src/cli.ts`, including from the CLI test that only inspects registered subcommands) eagerly constructs an engine instance. The engine is side-effect-free at construction (it only allocates a `Set`), so this is harmless today, but it ties the CLI module's lifetime to a single shared engine singleton with shared `subscribers`. If a future ticket lets the CLI register its own observers, multiple CLI invocations in the same process would share subscriber state. Not a bug; worth noting because the existing `state.ts` does not have this shape.
- **What to change:** Optional. Construct the engine lazily inside the `tick` default thunk (`tick: (input) => createWorkflowEngine(defaultEngineDeps).tick(input)`), or pass the deps and build the engine per invocation. The latter aligns better with the spec's "stateless between calls" framing.

### Minor — Plan's stderr refusal format differs from the spec's illustrative format

- **Location:** Spec line 196 says `triaged refused: no-state`. Plan's `formatRefusal` produces `engine refused (no-state): issue has no state label`.
- **Issue:** The CLI tests assert substring containment, not exact match, so both formats pass. The spec's wording is illustrative ("e.g."), so the divergence is acceptable, but a reader cross-checking spec → CLI output will see two different shapes.
- **What to change:** Optional. Either keep the plan's format (more informative — includes the refusal code explicitly) or match the spec literally.

### Minor — `formatSuccess` has unreachable fallthrough for `refuse` action kind

- **Location:** Task 8, `src/commands/engine.ts`, `formatSuccess` function.
- **Issue:** `formatSuccess` includes a comment-and-fallthrough for `action.kind === 'refuse'` (returning `${result.fromState} (action: refuse)\n`). But `formatSuccess` is only called when `!result.refused`, and a `refuse` action always sets `refused` in the TickResult, so this branch is genuinely dead. The plan calls this out as "reach here only if a future action kind is added", which is reasonable defensive programming, but it's worth being explicit that this is not currently reachable.
- **What to change:** Optional. Either accept as defensive programming (preferred), or have `formatSuccess` exhaustively handle wait/transition/spawn and `throw new Error('formatSuccess called with refusable action')` for refuse — surfacing a bug rather than printing a confusing line.

### Minor — `WriteChannel` type duplicated between `state.ts` and `engine.ts`

- **Location:** Task 8, `src/commands/engine.ts` redeclares `export type WriteChannel = 'stdout' | 'stderr';` (also in `src/commands/state.ts`).
- **Issue:** Minor stylistic drift. Two modules export the same alias. Not a bug, but consolidating into a shared module (e.g., `src/commands/io.ts`) would prevent drift. The plan does not flag this.
- **What to change:** Optional. Leave duplicated for now (parallel-construction style) or extract a shared alias when the third command lands.

### Minor — Plan's Task 8 spawn happy path test stretches the contract

- **Location:** Task 8, the third happy-path test (`prints the spawn summary on stdout and exits 0`).
- **Issue:** The test injects a successful spawn TickResult directly so it can exercise `formatSuccess`'s spawn branch, but the plan correctly notes that no production CLI invocation can produce this result today (no adapter is wired). This is fine — it locks the format string — but the test isn't really a CLI integration test, it's a `formatSuccess` test routed through Commander. The note in the plan explains this. Worth confirming the implementing agent doesn't read this as "spawn works end-to-end via the CLI today".
- **What to change:** Optional. Either keep as-is with the in-plan comment (already done) or rename the test to make its purpose explicit ("formatSuccess renders the spawn summary via the CLI plumbing").

## Notes

- Spec coverage is complete: all six refusal codes have a test, both events (`decision`, `transition`) are asserted with timestamps tied to `now`, every action kind exercises both engine and CLI branches, and the CLI exit-code matrix matches the spec table.
- Type-level consistency is solid. `AgentTaskRequest` is defined once in `policy.ts` and re-exported by `engine.ts`; `EngineAction` is the discriminated union the spec mandates; `PolicyInput` matches spec field-for-field.
- The InvalidTransitionError catch path is symmetric across the transition and spawn branches — both surface `invalid-transition` after the agent has been started, which matches the spec's "perform the transition exactly as the transition branch" instruction.
- The "let adapter errors propagate" test in Task 6 locks an intentional choice that the spec leaves implicit. The engine.ts header comment in the plan flags that the spec's refusal-code list is closed and adding `agent-failed` would be a spec change. This is a useful contract guard.
- The plan correctly identifies that `defaultPolicy` is total (handles `closed` even though the engine short-circuits earlier), which keeps the policy test simple.
- Order-of-events guarantee (`decision` before `transition`) is asserted in the multi-subscriber test (Task 5) and in the transition happy path (Task 4) — strong coverage.
- All file paths, import paths (`*.js` extensions), and command registration patterns match the existing `state.ts` / `state-command.test.ts` conventions. No drift on module structure.

verdict: pass_with_findings
