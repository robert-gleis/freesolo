# Plan Review — Issue #52, Round 1

**Status:** pass_with_findings

**Reviewer summary:** Plan is overall sound, follows the repo's conventions (NodeNext `.js` imports, vitest, strict TS, Zod 4.x array-form `z.enum`), and traces every spec requirement to a concrete task. The runtime, extractor, schemas, prompts, tests, and fixtures all line up with the spec, and the script-matching semantics in `ScriptedAgentAdapter` (string=exact, RegExp=`.test`) are respected by every test script in the plan. There are, however, a handful of concrete issues — most importantly a confused TDD cycle in Task 13, a redundant double-stop in the lifecycle implementation, a potentially invariant type assignment for `schemaForTask`, and the omission of `adapter.start()` failure handling — that should be cleaned up before execution. None of them are fundamental design issues; they are local edits.

## Findings

### Finding 1: Task 13 collapses two implementations into one step and breaks TDD red/green discipline
**Severity:** major
**Location:** Task 13, Steps 3–5
**Issue:** Step 3 prints a minimal `runPlanner` that does not call `adapter.start`. Step 4 then says "Expected: FAIL — `ScriptedAgentAdapter` rejects `send` because it is in `idle` state" — but the failure is from an unrelated `AgentAdapterError('invalid-state')` thrown by the adapter, not from a missing assertion, which is not a clean red bar for the behaviour being tested. Step 4 then immediately re-prints a second, lifecycle-aware implementation inside the same step ("Actually — to keep the green-bar discipline of TDD, adjust this task ..."), and Step 5 reruns the tests against the new implementation. The result is two implementations in a single task with no clear before/after structure, and a "red bar" that succeeds for the wrong reason.
**Fix:** Split Task 13 into 13a / 13b, or simply make Step 3 ship the lifecycle-aware implementation directly (auto-start on `idle`/`stopped`). The minimal-then-rewrite framing adds no value once the test fixture (the adapter created via `new ScriptedAgentAdapter({...})`) is in `idle` state — the minimal implementation never had a green bar anyway. Drop the "Actually — ..." paragraph and ship the lifecycle-aware version as the first impl.

### Finding 2: `stopIfOwned()` is called twice on the success and `invalid-output` paths
**Severity:** minor
**Location:** Task 15, Step 3 (runtime body)
**Issue:** Inside the `try` block, the success branch calls `await stopIfOwned()` before `return wrapResult(...)`, and the post-loop branch calls `await stopIfOwned()` before `throw new PlannerError('invalid-output', ...)`. Both throw/return paths re-enter the `catch (err)` clause (the `throw` only on the invalid-output path; the success `return` does not), and the `if (err instanceof PlannerError)` branch calls `await stopIfOwned()` a *second* time. `ScriptedAgentAdapter.stop()` is idempotent so this is harmless today, but a real adapter may not be — and the double-call obscures the intent. It also makes the test "stops it on success" subtly opaque (state ends `stopped` either way).
**Fix:** Either (a) drop the in-loop `stopIfOwned()` calls and rely solely on the catch + a `finally` block (preferred — `finally { await stopIfOwned(); }` is the canonical pattern), or (b) remove the `await stopIfOwned()` from the `instanceof PlannerError` branch of the catch so that PlannerErrors thrown from `extractJson` get stopped once and explicitly-thrown ones don't get stopped twice. Pattern (a) is cleaner and also implicitly handles `start()` failures (see Finding 4).

### Finding 3: `schemaForTask` return type may not satisfy Zod 4's invariance through `ZodType<Output>`
**Severity:** minor
**Location:** Task 13/14/15 runtime — `function schemaForTask(task): z.ZodType<TeamDefinition | DecompositionPlan>`
**Issue:** Returning `teamDefinitionSchema` (a `z.ZodObject<{...team shape...}>`) from a function declared as `z.ZodType<TeamDefinition | DecompositionPlan>` relies on `ZodType` being covariant in its Output type. In Zod 4 `ZodType<Output, Input, Def>` is technically invariant through internal `_def` members in some configurations; in practice the assignment usually compiles, but the spec did not call this out and the plan does not include a cast or a discriminated branch. If this hits an invariance error under `strict`, the build will fail.
**Fix:** Either (a) widen with `as z.ZodType<TeamDefinition | DecompositionPlan>` at the return site, (b) split into `function schemaForTask(task): ZodTypeAny` and let `wrapResult` narrow via `task`, or (c) return `z.ZodObject<z.ZodRawShape>` and rely on the runtime check. The plan should pre-empt this with a one-line cast so the reviewer doesn't have to guess.

### Finding 4: `adapter.start()` failures are not wrapped; only `adapter.send()` failures are
**Severity:** minor
**Location:** Task 15, Step 3 (runtime body)
**Issue:** The `await adapter.start(...)` call sits *above* the `try { ... } catch` block. If `start()` rejects (e.g., a real adapter fails to spawn its host), the raw `AgentAdapterError` propagates to the caller unwrapped. The spec is silent on `start()` failures, but the error-class table in §Errors lists `'adapter-failed'` as covering "adapter.send rejected" — the planner's contract should consistently surface adapter failures via `PlannerError`, not let one shape leak and another get wrapped. Symmetry with `send()` is the principle of least surprise.
**Fix:** Move the `await adapter.start({...})` call inside the `try` (or wrap it in its own try). On rejection, throw `PlannerError('adapter-failed', errorMessage(err), { cause: err })`. Update the spec's behaviour table (or just JSDoc on `runPlanner`) to mention this. If the spec is meant to allow raw `start()` errors to bubble, add an explicit test for that behaviour so the contract is documented in code; right now it's neither tested nor wrapped.

### Finding 5: Test "Re-prompt success" doesn't actually verify the validation error reaches the retry prompt
**Severity:** minor
**Location:** Task 14, Step 1 (`runPlanner retry loop`, first test)
**Issue:** The spec calls for: "Asserts the second script step matched a retry-prompt input via a substring match on the validation error." The plan's regex on the second step is `/previous response did not match/i`, which matches `buildRetryPrompt`'s preamble but does not check that the *zod error text* was inlined. Any retry prompt would match, even an empty one. The retry-prompt contract (validation error → next prompt) is therefore not test-enforced; only that *some* retry prompt was sent.
**Fix:** Strengthen the second step's `match` to something like `/Validation error:[\s\S]*roles/i` (asserting the rendered zod issue surface — `roles` path or `required` text) so the test fails if `buildRetryPrompt` is ever changed to drop the error body. Alternative: add a separate assertion that captures the second prompt (via a `send` spy) and asserts substring containment of the zod issue message.

### Finding 6: `tests/unit/planner-index.test.ts` is created in Task 18 but missing from the "New test files" header list
**Severity:** minor
**Location:** Plan header — "New test files"; Task 18 Step 3
**Issue:** The file-structure block at the top of the plan lists 7 new test files. Task 18 Step 3 creates an 8th (`tests/unit/planner-index.test.ts`) without amending the inventory. Task 21 Step 2 then says "at least 7 new test files" while listing 8. Cosmetic inconsistency, but a reviewer counting files at completion has to reconcile it.
**Fix:** Add `tests/unit/planner-index.test.ts` to the "New test files" inventory at the top of the plan. Update Task 21 Step 2 to say "8 new test files" with the exact list.

### Finding 7: Task 16 ships a test-only commit with no red-bar step
**Severity:** minor
**Location:** Task 16, Steps 1–3
**Issue:** Step 2 says "Expected: PASS — the runtime already wraps non-PlannerError throws into `adapter-failed`". The test is added, runs green on first run, and is committed. This is not strictly TDD — there is no red bar before the green bar, because the behaviour was already implemented in Task 15. The plan elsewhere insists on a fail-first cadence. Stylistically inconsistent.
**Fix:** Either (a) acknowledge in Task 16's preamble that this is a regression test for behaviour shipped in Task 15 (not new behaviour), or (b) fold Task 16's tests into Task 15's test suite, written *before* the lifecycle code introduces the wrapping, so the tests have a red-bar moment alongside the lifecycle ones. (a) is the lighter-touch option and matches recent merged commits in this repo.

### Finding 8: Snapshot test for `buildRetryPrompt` will be brittle across Zod patch releases
**Severity:** minor
**Location:** Task 12, Step 2 (`planner-prompts.snapshot.test.ts`)
**Issue:** The retry-prompt snapshot embeds the formatted zod error text, which is sourced from `error.issues[*].message`. Zod 4.x has refined wording between patch releases ("Expected string, received number" ↔ "Invalid input: expected string, received number"); a `zod` patch bump would silently update the snapshot. This is not a correctness bug, but it will cause spurious snapshot churn for an unrelated dependency upgrade.
**Fix:** Either (a) only snapshot the *structural* parts of the retry prompt (preamble + footer) and assert the validation-error block matches a structural regex rather than a verbatim line, or (b) put a comment in the snapshot test acknowledging that Zod patch upgrades will require `-u` to refresh. (a) is more robust; (b) is fine if the team is comfortable with the churn.

### Finding 9: Task 5 ("Refactor HostTool to const-array form") is asserted to be type-equivalent, but no test verifies behaviour for downstream consumers
**Severity:** minor
**Location:** Task 5, Step 2
**Issue:** The task replaces `export type HostTool = 'codex' | 'claude' | 'cursor';` with the const-array form. The plan claims `npm test` will verify type-equivalence. This is true at the type level, but the change subtly alters runtime semantics — `HOST_TOOLS` is now an importable value, and any future code mistakenly iterating it (e.g., `for (const h of HOST_TOOLS)`) shares a memory reference with all callers. There's no risk today but a regression test guarding "`HOST_TOOLS` contains exactly these three values, in this order" would be cheap insurance for the host-enum-consistency test in Task 6 (which currently asserts containment but not exact membership).
**Fix:** Add a one-liner to Task 6 asserting `expect([...HOST_TOOLS]).toEqual(['codex', 'claude', 'cursor'])`. This guards against accidental mutation or reordering of `HOST_TOOLS` later.

### Finding 10: `extractJson` snippet truncation test is fragile under whitespace trimming
**Severity:** minor
**Location:** Task 7, Step 1 — "truncates snippet to 500 chars in error details"
**Issue:** The test creates `'x'.repeat(1000)` and asserts `snippet?.length === 500`. The implementation calls `output.trim()` at the top and uses `trimmed.slice(0, 500)`. For an input of 1000 `x` characters, trim is a no-op so the test passes. But the implementation slices `trimmed`, not `output`. If a real test fixture has leading whitespace that the snippet should preserve (for debugging), this would silently drop it. Not a bug in the plan, but worth noting.
**Fix:** No change needed if the spec intent is "snippet is bounded ≤ 500 chars" (which is what the spec says). Consider adding `expect((err as PlannerError).details.snippet).toMatch(/^x{500}$/)` for tighter coverage. Optional.

---

**Net assessment:** The plan is implementable as written, but Findings 1, 2, 3, and 4 are worth addressing before execution. Finding 1 (split Task 13) is the highest-leverage change — the current step-4 narrative will confuse anyone executing the plan literally. Findings 2–4 are local fixes to the lifecycle implementation. Findings 5–10 are polish.
