# Plan Review — Issue #50, Round 2

## Status
pass

## Summary
The updated spec and plan resolve all three major round-1 findings. Session bootstrap is now explicitly `create-chat`-only on `start` (ignoring `initialInstructions`, matching `ScriptedAgentAdapter` and the engine's `spawn` path in `src/workflow/engine.ts`), the plan's test list covers every row in the spec Testing section, and Task 2's implementation snippet is copy-runnable without placeholder argv logic. Minor round-1 items (optional constructor default, `createDefaultCursorAgentDeps` naming, `stopping` transition, `lastActivityAt` cleared on restart, `create-chat` process `cwd`, per-task commits, missing `session_id` parser test) are all addressed. The plan is implementation-ready.

## Round 1 follow-up

1. **Engine `spawn` double-invocation (major)** — addressed. Spec Session model §`start` and plan architecture note now state that `start` always runs `create-chat` only and **ignores** `initialInstructions`; the first prompt is delivered exclusively via `send`. This matches `ScriptedAgentAdapter` and the engine's existing `start` → `send` sequence with the same string. Verified against `src/workflow/engine.ts` lines 174–178.

2. **Spec testing section not fully covered (major)** — addressed. Task 2 adds `start with initialInstructions still calls create-chat only` and `start failure transitions to error with start-failed code` (including `status().error`). Task 3 adds `send failure transitions to error with send-failed code` and `stop clears session and allows restart` (with `lastActivityAt` cleared). All nine spec-listed adapter lifecycle rows are now mapped to concrete tests.

3. **Task 2 placeholder argv logic (major)** — addressed. Task 2 Step 3 uses `this.deps.run(['create-chat'], { cwd: input.workingDirectory })` with no deferred cleanup or unused `binary` variable.

4. **Constructor / factory shape (minor)** — addressed. Task 4 sets `constructor(deps: CursorAgentDeps = createDefaultCursorAgentDeps())` and documents moving the factory above the class.

5. **`createCursorAgentRunner` name drift (minor)** — addressed. File Structure table and Task 4 consistently use `createDefaultCursorAgentDeps`.

6. **`stopping` state unused (minor)** — addressed. Task 2 `stop()` sets `this.state = 'stopping'` before clearing session and setting `stopped`; a note explains the transition may not be observable in unit tests (same pattern as issue #33).

7. **`lastActivityAt` not cleared on restart (minor)** — addressed. Task 2 `start` body sets `this.lastActivityAt = undefined`; Task 3 restart test asserts it is cleared after `stop` → `start`.

8. **`create-chat` production runner omits process `cwd` (minor)** — addressed. Task 4 runs `execa(binary, ['create-chat'], { cwd: options?.cwd })`; adapter passes `{ cwd: input.workingDirectory }` on the create-chat call.

9. **No per-task commit steps (nit)** — addressed. Each task ends with `git add` + `git commit` and a descriptive message.

10. **Parser tests omit `session_id` missing case (nit)** — addressed. Task 1 includes `throws when session_id field is missing`.

11. **Unused `binary` in Task 2 snippet (nit)** — addressed. Removed from the adapter implementation block.

## New findings

None actionable.

Optional observations (no plan changes required):

1. **nit — ScriptedAgentAdapter parity tests not duplicated.** `tests/unit/scripted-agent-adapter.test.ts` covers `send` after `stop` → `invalid-state` and idempotent double-`stop`. The spec Testing section does not list these cases and the plan does not add them. Acceptable; add only if cross-adapter parity testing becomes a repo convention.

2. **nit — Recovery from `error` state is implicit.** After a failed `start` or `send`, state is `error`; `start` from `error` throws `invalid-state` until `stop()` transitions to `stopped`. Behaviour follows from the state guards and is consistent with the spec; no dedicated test is required by the spec.

3. **nit — Spec Approaches table mentions parsing "stderr/stdout" but the plan parses stdout only.** Session model and CLI contract sections specify stdout for `create-chat` (plain text) and JSON on stdout for `--print` invocations. The plan matches the detailed contract; the table row is slightly broader than the implementation scope.

## What looks good

- **Spec/plan alignment:** Session model, CLI contract, dependency injection, testing list, and spec coverage table are internally consistent and match the planned code snippets.
- **Engine integration:** No engine changes required; `spawn` path compatibility is explicitly documented and verified against current `engine.ts` behaviour.
- **No launch-plan regression:** `src/adapters/cursor.ts` and `tests/unit/adapters.test.ts` remain untouched; Task 5 runs full `npm test` + `npm run build`.
- **Strict TDD:** Each task is a red/green cycle with concrete run commands, expected failure modes, and cumulative test counts (5 → 10 parser + adapter tests).
- **Injectable I/O:** `fakeDeps` + `vi.fn` pattern; production path isolated in `createDefaultCursorAgentDeps`; `execa` already in `package.json`.
- **Argv/binary contract:** Adapter passes logical args without binary; factory owns `execa(binary, args)` and branches on `args[0] === 'create-chat'`.
- **Reference adapter parity:** `stop` no-op from `idle`, `lastActivityAt` cleared on `start`, `initialInstructions` ignored on `start` — all match `ScriptedAgentAdapter` patterns in `src/agents/scripted.ts`.
- **File layout:** Flat `tests/unit/cursor-agent-*.test.ts` matches post–issue-#33 convention; barrel export extends `src/agents/index.ts` without disturbing existing exports.

## Spec coverage table

| Spec requirement | Plan task | Status |
|------------------|-----------|--------|
| `CursorAgentAdapter` implements `AgentAdapter` | Tasks 2–4 | Covered |
| `parseCursorAgentJson` / JSON line parser | Task 1 | Covered |
| `CursorAgentDeps` with injectable `run` | Tasks 2–4 | Covered |
| `binary` defaults to `cursor-agent`, overridable | Task 4 | Covered |
| `start`: idle\|stopped → starting → running | Task 2 | Covered |
| `start` always → `create-chat`; ignores `initialInstructions` | Task 2 | Covered + tested |
| `send` → `--resume` + `--print` + workspace + prompt | Task 3 | Covered |
| `stop` no-op from idle/stopped; clears session; brief `stopping` | Task 2 | Covered + tested |
| `status` snapshot with timestamps/error | Task 2 | Covered |
| CLI failure → `error` state + `AgentAdapterError` | Tasks 2–3 | Covered + tested |
| `lastActivityAt` on successful `send`; cleared on `start` | Tasks 2–3 | Covered + tested |
| Engine `spawn` path (start then send, no double invoke) | Architecture note, Task 2 | Covered |
| Re-export from `src/agents/index.ts` | Task 4 | Covered |
| No changes to `src/adapters/cursor.ts` | File structure, Task 5 | Covered |
| `constructor(deps?)` optional | Task 4 | Covered |
| `create-chat` with process `cwd` | Task 4 | Covered |
| Spec Testing section (all nine lifecycle rows) | Tasks 1–3 | Covered |
| `tests/unit/cursor-agent-json.test.ts` incl. missing `session_id` | Task 1 | Covered |
