# Plan Review — Issue #40, Round 2

## Verdict
pass

## Summary

The updated plan addresses every major and minor finding from round 1. Task steps now enumerate concrete test cases (lifecycle parity, send error-state transitions, stop-from-error, default-invoker argv/exit-code coverage, parser edge cases), specify the `index.ts` export surface, document `workingDirectory` persistence, and add self-review notes for intentional #33 state-machine simplification and parser-vs-adapter error wrapping. The plan remains aligned with the approved design spec and the engine spawn path in `src/workflow/engine.ts:174–178`. No new blocking or significant gaps were found.

## Round 1 follow-up

### Major

1. **Parser tests omit `empty stdout` case (round 1 #1)** — addressed. Task 1 adds `throws when stdout is empty` and `throws when stdout is whitespace-only` with `/thread_id/` assertions, matching the spec testing table.

2. **`send` failure → `error` state not pinned (round 1 #2)** — addressed. Task 3 Step 1 explicitly requires assertions for `state === 'error'`, non-empty `status.error`, and subsequent `send` → `invalid-state` without another invoker call.

3. **`stop()` from `error` state not covered (round 1 #3)** — addressed. Task 3 adds `stop from error clears threadId and moves to stopped` with start → failed send → stop flow.

4. **Task 2 lifecycle cases not enumerated (round 1 #4)** — addressed. Task 2 Step 1 lists idle-before-start, start-without-invoke, `start-failed`, double-start `invalid-state`, start-from-stopped, stop no-op from idle, running→stopped, idempotent stop, and `lastActivityAt` cleared on restart (mirroring Claude stop describe).

5. **Task 3 send tests omit Claude-parity cases (round 1 #5)** — addressed. Task 3 covers rethrow `AgentAdapterError`, wrap non-`AgentAdapterError`, reject `send` after `stop`, stop-clears-threadId on restart, and default-invoker non-zero exit → `send-failed` with stderr excerpt via `codex-default-invoker.test.ts`.

6. **`workingDirectory` persistence on `start` not stated (round 1 #6)** — addressed. Task 2 implementation note requires `this.workingDirectory = input.workingDirectory` on successful `start`; Task 3 guards `send` with it; self-review bullet confirms cwd comes from last `start`.

### Minor

1. **Top-level `error` JSONL lines lack fixture tests (round 1 minor #1)** — addressed. Task 1 adds fatal `{"type":"error",...}` and transient `Reconnecting...` ignore tests.

2. **Integration test thinner than #39 reference (round 1 minor #2)** — addressed. Task 4 now asserts `(await agent.status()).state === 'running'` after spawn alongside invoker shape, `toState`, and event kinds.

3. **Default invoker has no direct test coverage (round 1 minor #3)** — addressed. New `tests/unit/codex-default-invoker.test.ts` with mocked `execa` covers first-turn vs resume argv, `reject: false`, exit-code mapping, and parser-failure wrapping.

4. **`index.ts` export surface underspecified (round 1 minor #4)** — addressed. Task 2 Step 4 names `CodexAgentAdapter`, `CodexAgentAdapterOptions`, `CodexInvoker`, `CodexInvokeInput`, `CodexInvokeResult`, `parseCodexExecJsonl`, and `createDefaultInvoker` (if exported).

5. **#33 `starting`/`stopping` simplification undocumented (round 1 minor #5)** — addressed. Self-review bullet documents intentional `idle|stopped → running` and direct `→ stopped` semantics vs #33 intermediates.

### Nit

1. **Integration test filename convention (round 1 nit #1)** — addressed. Plan uses `codex-agent-workflow-integration.test.ts`, matching adapter-prefixed pattern.

2. **Task 2 temporary `send` stub message (round 1 nit #2)** — addressed. Placeholder is `send-failed: not implemented yet` for grep-friendly red steps.

3. **Parser `Error` vs `AgentAdapterError` wrapping (round 1 nit #3)** — addressed. Task 1 implementation note and self-review clarify plain `Error` in parser; `createDefaultInvoker` wraps as `send-failed`.

## New findings

None significant. Optional nits only:

1. **nit — `start` clearing `status.error` on restart after error→stop not explicit (plan: Task 2 Step 3; spec: `start` lines 99–104).** Design requires clearing `threadId` and `lastActivityAt` on `start`; it does not name `error`, but `ScriptedAgentAdapter` clears error on `start`. The error→stop→start path is partially covered by stop-from-error and start-from-stopped tests; adding one assertion that `status().error` is undefined after a fresh `start` would lock parity. Implementers following Claude/scripted patterns will likely get this right without plan changes.

2. **nit — Integration test filename differs from design architecture block (design: `codex-workflow-integration.test.ts`; plan: `codex-agent-workflow-integration.test.ts`).** Intentional alignment with #39 adapter-prefixed naming from round 1; no functional impact.

## Sanity checks

- Engine spawn path verified: `deps.agent.start({ workingDirectory, initialInstructions })` then `deps.agent.send(initialInstructions)` at `src/workflow/engine.ts:174–178` — Task 4's single-invoker-call assertion is correct.
- `CodexInvoker` / `CodexInvokeInput` / `CodexInvokeResult` shapes match design spec; resume argv omits `--skip-git-repo-check` per spec.
- `execa` is an existing dependency (`package.json`); default invoker test strategy via `vi.mock` is viable.
- `src/adapters/codex.ts` (`buildCodexLaunchPlan`) correctly left untouched per spec non-goals.
- Claude reference tests (`claude-code-agent-adapter.test.ts`, `claude-code-workflow-integration.test.ts`) are not on this branch; plan cites them as parity targets only — acceptable.

## What looks good

- TDD task ordering with concrete vitest commands and full-suite gate (Task 5).
- Copy-paste-ready parser fixture suite in Task 1 Step 1.
- Codex-specific error-state behavior on failed `send` is now explicitly tested and called out as differing from Claude #39 — reduces implementer confusion.
- Default invoker argv split (first turn vs resume) and `--skip-git-repo-check` placement match design and cheatsheet.
- `start` never auto-sends; engine compatibility preserved without `engine.ts` edits.
