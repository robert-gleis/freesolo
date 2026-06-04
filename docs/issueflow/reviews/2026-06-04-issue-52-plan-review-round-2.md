# Plan Review — Issue #52, Round 2

**Status:** pass

**Reviewer summary:** All ten round-1 findings are addressed by concrete edits in the patched plan. The runtime now uses a single `try { ... } catch { ... } finally { await stopIfOwned(); }` pattern with `plannerOwnsAdapter` set strictly after `adapter.start` resolves, the retry test asserts on the rendered Zod issue surface, the snapshot test splits at the `Validation error:` marker and snapshots only structural framing, and Task 16 now has both a TDD-framing preamble and an `adapter.start`-rejection regression test. Walking the lifecycle and retry test scenarios against the new `runPlanner` body confirms each lifecycle invariant still holds — including the start-rejection path where `plannerOwnsAdapter` is never flipped to `true` and `stopIfOwned()` is a no-op. No new defects or regressions found.

## Resolution of Round-1 Findings

| # | Finding | Resolution |
|---|---------|------------|
| 1 | Task 13 collapsed two implementations into one step | ✓ resolved — Task 13 Step 3 now ships the lifecycle-aware (auto-start) impl directly. The "Actually — ..." rewrite narrative is gone. Step 3 preamble explicitly states "We ship the lifecycle-aware single-attempt implementation directly here". |
| 2 | Double `stopIfOwned()` calls on success / invalid-output paths | ✓ resolved — Task 15 implementation now uses `try { ... } catch { ... } finally { await stopIfOwned(); }`. In-loop `stopIfOwned()` calls are removed and `stopIfOwned()` only fires in the `finally` block (single point of cleanup). The catch no longer awaits stop. |
| 3 | `schemaForTask` invariance through `z.ZodType<...>` | ✓ resolved — Task 13's `schemaForTask` casts both return values with `as z.ZodType<TeamDefinition \| DecompositionPlan>` and includes an inline comment explaining the cast is sound because `safeParse` + `wrapResult` enforce the runtime check. |
| 4 | `adapter.start` failures unwrapped | ✓ resolved — Task 15's implementation moves `await adapter.start(...)` *inside* the `try` and sets `plannerOwnsAdapter = true` only AFTER start resolves. Task 16 Step 1 adds a dedicated test (`wraps adapter.start rejection in PlannerError("adapter-failed", ..., { cause })`) that overrides `adapter.start` (not `send`), asserts the error is wrapped with `cause` preserved, and asserts `stopCalls === 0` to verify the `finally` doesn't call `stop()` on an unstarted adapter. |
| 5 | Retry test regex too weak | ✓ resolved — Task 14's retry test uses `/Validation error:[\s\S]*(roles\|required\|count)/i`, which asserts the rendered Zod issue surface (the path text or "required" wording) reaches the second send. The previous `roles`-missing payload will produce a `roles.0.count` path under `formatZodError`, so the regex matches. |
| 6 | `planner-index.test.ts` missing from inventory header | ✓ resolved — header "New test files" block now lists 8 entries including `tests/unit/planner-index.test.ts`. Task 21 Step 2 says "exactly 8 new test files" and enumerates them. |
| 7 | Task 16 TDD framing | ✓ resolved — Task 16 now has a "Note on TDD discipline" preamble that explicitly acknowledges these are regression tests for behaviour shipped in Task 15 and that the tests run green on first execution by design. |
| 8 | Retry-prompt snapshot brittleness | ✓ resolved — Task 12's snapshot test splits the prompt at the `Validation error:` marker, snapshots `preamble` and `footer` separately, and asserts the error block matches the structural regex `/^\n- [^\n]+: [^\n]+(\n- [^\n]+: [^\n]+)*$/`. A comment explains the rationale (avoid Zod patch-release churn). |
| 9 | `HOST_TOOLS` exact membership | ✓ resolved — Task 6 Step 1 includes `expect([...HOST_TOOLS]).toEqual(['codex', 'claude', 'cursor'])` as a dedicated `it(...)` block ("HOST_TOOLS contains exactly the documented host triple in declared order"). |
| 10 | Snippet truncation tightening | ✓ resolved — Task 7 Step 1's truncation test adds `expect((err as PlannerError).details.snippet).toMatch(/^x{500}$/)` alongside the existing length assertion. |

## New Findings

(none)

---

**Walk-through verification of the new lifecycle code in Task 15:**

Walked every test scenario in Task 15 Step 1 against the new `try`/`catch`/`finally` body:

- *idle on entry, success* → status=idle, shouldStart=true, start ok, plannerOwnsAdapter=true, send→valid, return, finally stops. End state `stopped`. ✓
- *idle on entry, extract-failed* → start, plannerOwnsAdapter=true, send→bad output, extractJson throws PlannerError, catch re-throws (PlannerError branch), finally stops. End state `stopped`. ✓
- *caller-started, success* → status=running, shouldStart=false, plannerOwnsAdapter stays false, send→valid, return, finally `stopIfOwned()` no-op. End state `running`. ✓
- *caller-started, failure* → same shouldStart=false path; finally is a no-op. End state `running`. ✓
- *starting state* → status returns `starting`, throw `adapter-not-ready` BEFORE `try`, finally never runs, sendCalls=0. ✓
- *start rejection (Task 16)* → start throws boom, plannerOwnsAdapter never set, catch wraps as `adapter-failed`, finally `stopIfOwned()` is no-op (stopCalls=0). ✓
- *send rejection (Task 16)* → start ok, plannerOwnsAdapter=true, send throws, catch wraps as `adapter-failed`, finally stops. End state `stopped`. ✓

The `stopIfOwned` helper internally swallows any error from `adapter.stop()`, so a stop-throw inside the `finally` block cannot mask the original error (verified by the explicit `try { await adapter.stop(); } catch { /* ... */ }` inside `stopIfOwned`).

**Retry-prompt regex verification:**

`buildRetryPrompt` (Task 11) produces:
```
The previous response did not match the required schema.
<blank>
Validation error:
- <path>: <message>
<blank>
Respond again with a single JSON object that matches the schema exactly. No explanations, no markdown.
```

For the Task 14 retry-success test, the first send returns `{"roles":[{"name":"Eng","host":"claude","responsibility":"Do it."}]}` — missing `count`. Zod will issue at path `['roles', 0, 'count']` with message "Required" (or "Invalid input: expected number..."). `formatZodError` renders this as `- roles.0.count: <message>`. The regex `/Validation error:[\s\S]*(roles|required|count)/i` matches against the `roles` and `count` literals in the path, so the retry script step matches deterministically. ✓
