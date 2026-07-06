# Plan Review — Issue #39, Round 1

## Status
pass_with_findings

## Summary
The plan is implementable as written: it mirrors `ScriptedAgentAdapter` lifecycle semantics, isolates subprocess I/O behind `ClaudeInvoker`, uses flat `tests/unit/` paths consistent with the repo, and correctly handles the engine spawn path (`start` records cwd and enters `running` without invoking; the engine's subsequent `send(initialInstructions)` is the sole first prompt). TDD steps are concrete with copy-runnable code and explicit vitest commands — no TBDs. The main gaps are missing tests for a few spec-listed behaviors (`start-failed` on bad cwd, spawn-contract pinning when `initialInstructions` is passed to `start`, transition events in the integration test) and a stale contradictory paragraph in the spec itself (lines 82–86 vs the chosen design at lines 121–123) that the plan correctly follows but does not call out.

## Findings

1. **minor — Spec contains contradictory `start` semantics; plan follows the chosen design but the hazard is unacknowledged (spec: lines 82–86 vs 121–123; plan: Task 1).** The spec's `ClaudeCodeAgentAdapter` section first says `start` performs an internal invoke when `initialInstructions` is present, then later **chooses** deferred invoke: `start` does not auto-send and the engine's explicit `send` is the single first message. The plan implements the chosen design (`expect(invoker).not.toHaveBeenCalled()` on `start`, integration test expects exactly one invoke). Recommend deleting or rewriting spec lines 82–86 before implementation so a reader does not implement the superseded path and reintroduce double-prompting on `engine.ts` lines 174–178.

2. **minor — No test pins that `start` ignores `initialInstructions` even when the engine passes it (plan: Task 1, lifecycle test "start moves to running").** The lifecycle test calls `start({ workingDirectory })` without `initialInstructions`. The real spawn path always passes both fields to `start` and then `send`s the same string (`engine.ts` 174–178). A one-line addition — `start({ workingDirectory, initialInstructions: 'implement feature' })` plus `expect(invoker).not.toHaveBeenCalled()` — would lock the anti-double-prompt contract that motivated the spec's design choice.

3. **minor — `start-failed` on inaccessible cwd is implemented but not tested (plan: Task 1 Step 3 `fs.access` guard; spec: Error mapping table).** The plan throws `AgentAdapterError('start-failed', …)` when `fs.access` fails, matching the spec, but no red/green step asserts it. Add a test with a non-existent `workingDirectory` expecting `{ code: 'start-failed' }` so the error-code mapping does not regress silently.

4. **minor — Integration test omits transition-event assertions required by the spec acceptance table (plan: Task 3; spec: Acceptance criteria "engine emits transition events").** `workflow-engine.test.ts` already shows the pattern (`expect(harness.events.map((e) => e.kind)).toEqual(['decision', 'transition'])`). Task 3 only asserts `result.toState`, invoker call count, and adapter status. Subscribe via `engine.on()` (or a small harness) and assert a `transition` event fires after a successful spawn write — otherwise the acceptance row is only partially satisfied.

5. **minor — Invoker rejection wrapping is implemented but not exercised (plan: Task 2 `send` catch block).** The `send` implementation rethrows `AgentAdapterError` and wraps other errors as `send-failed`. No test passes an invoker that `mockRejectedValue(new Error('boom'))` and expects `{ code: 'send-failed' }`. Cheap coverage for the default-invoker error path when execa throws unexpectedly.

6. **minor — `stop()` idempotency from `stopped` is implemented but not tested (plan: Task 2 stop tests; spec: "From `stopped`: no-op").** `ScriptedAgentAdapter` has "is idempotent when already stopped" (`scripted-agent-adapter.test.ts`). The plan's stop tests cover idle no-op and running→stopped→restart, but not double-`stop()`. Observable behavior is likely correct (`if (idle || stopped) return`), yet the spec explicitly calls out stopped no-op — mirror the reference adapter test for parity.

7. **nit — Task 1 Step 3 prose says "default invoker stub (throw if called)" but the code block ships a full `createDefaultInvoker` using execa (plan: Task 1, Step 3).** The code is correct for Task 1 (invoker is never called until Task 2), but the step description and code block disagree. Cosmetic documentation fix only.

8. **nit — No per-task commit guidance (plan: all tasks).** Issue #33's plan included commit subjects and Co-Authored-By trailers per task. This plan omits them. Not blocking — implementer discretion — but inconsistent with the repo's recent plan style.

## What looks good

- **Engine spawn path is correct.** Verified against `engine.ts` 160–178: `start({ workingDirectory, initialInstructions })` then `send(initialInstructions)`. Task 1 asserts the invoker is not called on `start`; Task 3 asserts `invoker` is called exactly once with the spawn prompt and `sessionId: undefined`. No engine changes required; no double-prompt risk if the plan is followed.
- Every spec file path matches repo convention: `src/agents/claude-code.ts`, flat `tests/unit/claude-code-agent-adapter.test.ts` and `tests/unit/claude-code-workflow-integration.test.ts`, barrel update to `src/agents/index.ts`. Import paths use `../../src/...` like `scripted-agent-adapter.test.ts`.
- Strict TDD discipline: each task has failing-test command, expected failure mode, minimal implementation, and pass verification. No placeholders or "implement later" stubs in production code paths.
- State and error semantics align with the #33 `AgentAdapter` contract and `ScriptedAgentAdapter`: `invalid-state` for lifecycle violations, `start-failed` / `send-failed` for I/O and payload failures, `stop()` no-op from `idle`, session cleared on stop, `status()` snapshot shape matches (`state`, `startedAt`, `lastActivityAt`, `error`).
- `ClaudeInvoker`, `ClaudeInvokeInput`, and `ClaudePrintJson` match the spec character-for-character; injectable boundary keeps CI free of live CLI calls.
- Session resume is concretely tested: first `send` stores `session_id`, second `send` passes `sessionId` to the invoker; post-`stop` restart clears session.
- Task 4 gates on `npm test` and `npm run build`, catching TypeScript regressions across the full suite.
- Self-review table maps spec requirements to tasks; spot-checking each row holds.

STATUS=pass_with_findings
