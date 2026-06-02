# Plan Review — Issue #39, Round 2

## Status
pass

## Round 1 follow-up

1. **Spec contradictory `start` semantics (minor)** — addressed. Spec lines 82–86 now state that `start` does **not** invoke Claude even when `initialInstructions` is provided, aligning with the chosen design at lines 115–121. Task 4 commits the aligned spec and plan.

2. **No test pins `start` ignores `initialInstructions` (minor)** — addressed. Task 1 lifecycle test passes `initialInstructions: 'implement feature'` to `start` and asserts `expect(invoker).not.toHaveBeenCalled()`.

3. **`start-failed` on inaccessible cwd untested (minor)** — addressed. Task 1 adds `maps inaccessible working directory to start-failed` with a non-existent path expecting `{ code: 'start-failed' }`.

4. **Integration test omits transition-event assertions (minor)** — addressed. Task 3 subscribes via `engine.on()`, collects `eventKinds`, and asserts `expect(eventKinds).toContain('transition')`.

5. **Invoker rejection wrapping untested (minor)** — addressed. Task 2 adds `wraps non-AgentAdapterError invoker failures as send-failed` with `mockRejectedValue(new Error('boom'))`.

6. **`stop()` idempotency from `stopped` untested (minor)** — addressed. Task 2 adds `is idempotent when already stopped` (double `stop()` after running→stopped).

7. **Task 1 Step 3 prose vs code mismatch (nit)** — addressed. Step 3 now reads "default invoker implementation (`execa`)" and the code block ships the full `createDefaultInvoker`.

8. **No per-task commit guidance (nit)** — addressed. Tasks 1–4 each include Step 5 (or Step 3 for Task 4) with `git add` scopes and commit subjects with Co-Authored-By trailers.

## New findings

None blocking. Optional polish only:

1. **nit — Integration test asserts `transition` presence but not the full event sequence (plan: Task 3).** `workflow-engine.test.ts` spawn happy path expects `['decision', 'transition']`. Task 3 uses `toContain('transition')`, which satisfies the acceptance row but is weaker than the reference pattern. Tightening to `expect(eventKinds).toEqual(['decision', 'transition'])` would mirror existing engine tests; not required for implementation.

2. **nit — Two `ScriptedAgentAdapter` parity tests are absent (plan: Tasks 1–2).** `scripted-agent-adapter.test.ts` covers `send` after `stop` → `invalid-state` and `clears lastActivityAt on restart`. The plan's `start` body sets `lastActivityAt = undefined` on restart, so behavior should be correct, but explicit tests would lock parity. Optional; not spec-listed.

3. **nit — Spec documents `error` state in `stop()` / `status()` but the adapter throws on failure instead of entering `error` (spec: lines 98, 103).** Same intentional simplification as `ScriptedAgentAdapter` (#33): `errorMessage` exists but is never set; failures propagate as thrown `AgentAdapterError`. Consistent with the repo; no plan change needed unless the spec is tightened later.

## What looks good

- All eight round-1 findings are addressed in both the spec and the plan with no regressions.
- Engine spawn path remains correct: verified `engine.ts` 174–178 calls `start({ workingDirectory, initialInstructions })` then `send(initialInstructions)`. Task 1 pins no invoke on `start` with `initialInstructions`; Task 3 pins exactly one invoker call with the spawn prompt.
- TDD discipline is intact: each task has failing-test command, expected failure mode, minimal implementation, pass verification, and commit boundary.
- File paths, import style (`../../src/...`), types (`ClaudeInvoker`, `ClaudePrintJson`, `ClaudeInvokeInput`), error codes, and lifecycle semantics match the spec and #33 contract.
- Session resume, stop semantics (idle no-op, session cleared, stopped idempotency), and error paths (`is_error`, missing `result`, invoker rejection wrapping) are concretely tested.
- Task 4 gates on `npm test` and `npm run build`; self-review table maps every spec requirement to a task.
- Per-task commits restore consistency with the #33 plan style.

STATUS=pass
