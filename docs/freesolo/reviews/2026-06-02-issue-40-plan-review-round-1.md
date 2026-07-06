# Plan Review — Issue #40, Round 1

## Verdict
pass_with_findings

## Summary

The plan is well-structured TDD work broken into four incremental tasks that align with the approved spec, mirror the Claude adapter (#39) layout, and correctly assume no workflow-engine changes. Gaps are mostly in test completeness versus the spec's testing table and in underspecified assertions for error-state behavior and Claude-parity stop/send cases.

## Findings

### Critical

None.

### Major

1. **Parser tests omit `empty stdout` case required by spec (plan: Task 1; spec: Testing table line 146).** The spec's `codex-exec-json.test.ts` row explicitly lists `empty stdout`. Task 1's fixture suite covers happy path, multiple messages, missing `thread_id`, missing `agent_message`, and `turn.failed`, but never asserts behavior for `''` or whitespace-only input. Add a test (e.g. `throws when stdout is empty`) so the parser contract matches the spec acceptance table.

2. **`send` failure → `error` state is listed but not pinned with assertions (plan: Task 3 Step 1; spec: `send` contract lines 112–113).** Task 3 mentions "error state on failure" in the bullet list but does not specify assertions such as `status().state === 'error'`, `status().error` populated, and `send` rejected afterward with `invalid-state`. The Codex spec requires this; it also satisfies the #33 contract that failures surface via `status.error`. Claude (#39) does not transition to `error` on send failure — implementers following only the Claude file could miss this without explicit tests.

3. **`stop()` from `error` state not covered (spec: stop contract line 117; #33: stop from any state including `error`).** Spec says stop clears `threadId` and moves to `stopped` from `running` or `error`. Task 3 covers "stop clears thread" and "restart after stop" but does not require a test that reaches `error` via a failed `send`, then calls `stop()` and asserts `state === 'stopped'` and `threadId` cleared. Without it, the error→stopped path is unverified.

4. **Task 2 lifecycle tests reference Claude tests but do not enumerate parity cases (plan: Task 2 Step 1).** "Mirror `claude-code-agent-adapter.test.ts` lifecycle describe block" is directionally correct, but the plan should name the cases explicitly so nothing is dropped: idle before start, start without invoke, `start-failed` on bad cwd, double-start `invalid-state`, and (from Claude stop block) stop no-op from idle, idempotent stop, `lastActivityAt` cleared on restart. The restart/`lastActivityAt` case is easy to omit because it lives in Claude's stop describe, not lifecycle.

5. **Task 3 send tests omit several Claude-parity cases (plan: Task 3 Step 1).** Compared to `claude-code-agent-adapter.test.ts`, the plan does not call out: rethrow `AgentAdapterError` from invoker unchanged, wrap non-`AgentAdapterError` rejections as `send-failed`, reject `send` after `stop`, and default-invoker non-zero exit → `send-failed` with stderr excerpt (spec: default invoker lines 87–88). Mock-invoker tests can cover the first three; the exit-code path needs either a mocked `execa` or an invoker unit test.

6. **`workingDirectory` persistence on `start` not stated (plan: Task 2–3; spec: implied by invoker `cwd`).** Claude stores `this.workingDirectory` during `start` and guards `send` with `!this.workingDirectory`. The plan never mentions storing cwd on the adapter instance. Implementers could pass cwd only at construction time and break `send` after `start` with a different directory. Add an explicit implementation note: persist `input.workingDirectory` on successful `start`, same as Claude.

### Minor

1. **Top-level `error` JSONL lines lack a fixture test (plan: Task 1 Step 3; spec: line 39).** Implementation notes say throw on top-level `error` and ignore `"Reconnecting..."`, but Task 1 tests only `turn.failed`. Add a test for a fatal `{"type":"error",...}` line and optionally a test that a reconnect line is ignored rather than failing the parse.

2. **Integration test is thinner than #39 reference (plan: Task 4).** `claude-code-workflow-integration.test.ts` also asserts `(await agent.status()).state === 'running'` after spawn. Task 4 only lists invoker call shape, `toState`, and event kinds. Adding the status assertion would lock lifecycle behavior through the engine path.

3. **Default invoker has no direct test coverage (plan: Task 3).** Injectable `CodexInvoker` keeps unit tests off the real CLI (good), but `createDefaultInvoker` argument assembly (`exec`, `--json`, `-C`, `--skip-git-repo-check`, resume branch) and `reject: false` + exit-code handling are untested. A small test with `execa` mocked (or a focused `createDefaultInvoker` export test) would prevent argv regressions.

4. **`index.ts` export surface underspecified (plan: Task 2 Step 4).** Spec architecture exports `CodexInvoker`, `CodexInvokeInput`, and `parseCodexExecJsonl` for testing and injection. Plan says "re-export adapter + types" without naming `CodexInvokeInput`, `CodexInvokeResult`, `CodexInvoker`, `parseCodexExecJsonl`, and `CodexAgentAdapterOptions` (if added). Match Claude's barrel pattern explicitly.

5. **#33 `starting` / `stopping` states unused — acceptable but worth a self-review line (plan: architecture; #33 spec lines 50–53, 84–89).** Codex spec and plan follow Claude's simplified `idle|stopped → running` and direct `→ stopped` transitions, not #33's `starting`/`stopping` intermediate states. This matches shipped #39 behavior and is a documented simplification elsewhere; add one self-review bullet so reviewers do not flag it as a regression.

### Nit

1. **Integration test filename differs from #39 convention (plan: Task 4).** Plan uses `codex-workflow-integration.test.ts`; #39 uses `claude-code-workflow-integration.test.ts`. Either name works; aligning to `codex-agent-workflow-integration.test.ts` would match the adapter-prefixed pattern.

2. **Task 2 temporary `send` stub message not specified (plan: Task 2 Step 3).** "throws `not implemented` temporarily" — pick a stable message or `send-failed` placeholder so the red step failure is grep-friendly across tasks, as #33 plan did with `start-failed: not implemented yet`.

3. **Parser throw messages vs `AgentAdapterError` wrapping not specified (plan: Task 1 vs Task 3).** Task 1 tests use `/thread_id/` and `/agent_message/` regexes on parser throws. Task 3 should note that `createDefaultInvoker` wraps parser failures and non-zero exits as `AgentAdapterError('send-failed', ...)`, while the pure parser may throw plain `Error`.

## What looks good

- Clear TDD red/green steps with concrete vitest commands and a full-suite gate (Task 5).
- File layout matches spec (`src/agents/codex.ts`, flat `tests/unit/`, no engine edits, `src/adapters/codex.ts` untouched).
- `CodexInvoker` / `CodexInvokeInput` / `CodexInvokeResult` shapes match the spec; resume vs first-turn argv split matches spec and cheatsheet.
- Engine spawn path correctly assumed: `start({ workingDirectory, initialInstructions })` then `send(initialInstructions)` — verified in `src/workflow/engine.ts:174–178`; integration test intent matches `claude-code-workflow-integration.test.ts`.
- `start` does not auto-send; self-review calls this out — critical for engine compatibility.
- Parser fixture in Task 1 Step 1 is copy-paste ready and exercises the JSONL event types the spec names.
- `--skip-git-repo-check` on first turn only (not resume) matches spec resume command.
