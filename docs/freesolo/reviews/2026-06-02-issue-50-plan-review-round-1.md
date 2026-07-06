# Plan Review — Issue #50, Round 1

## Status
pass_with_findings

## Summary
The plan is well-scoped, follows the issue #33 TDD task pattern, keeps `src/adapters/cursor.ts` untouched, and correctly separates `create-chat` (session bootstrap, no `--print`) from `--print`/`--resume` invocations. Argv/binary handling is ultimately clear in Task 4 (`deps.run` receives logical args without the binary; `createDefaultCursorAgentDeps` calls `execa(binary, args)`). The main gaps are (a) a spec/plan integration tension with the workflow engine’s `spawn` path, which always calls `start({ initialInstructions })` then `send(initialInstructions)` while the spec says `start` with `initialInstructions` already runs a full headless invocation — yielding duplicate CLI runs unless clarified; (b) several spec-listed tests are missing from the plan (initial-instructions start path, CLI failure → `error` state); and (c) Task 2’s interim snippet still contains placeholder argv logic deferred to Task 4. None of these block starting implementation, but the engine double-invocation question should be resolved before wiring the adapter into `spawn`.

## Findings

1. **major — Engine `spawn` path likely double-invokes when `initialInstructions` is set (spec: Session model §`start`; Engine integration; plan: Task 2 `invokeAgent` + Task 3 `send`).** `src/workflow/engine.ts` always does `agent.start({ workingDirectory, initialInstructions })` followed immediately by `agent.send(initialInstructions)` with the same string. The spec says `start` with `initialInstructions` runs a full `--print --trust --output-format json --workspace <cwd> <instructions>` invocation, and `send` runs another `--resume … <input>` invocation. `ScriptedAgentAdapter` ignores `initialInstructions` on `start`, so only `send` does work today. Implementing the plan as written means two subprocess runs with identical prompts on every engine spawn — contradicting the spec’s claim that “the existing `spawn` path … works unchanged” unless double execution is intentional. Resolve before integration: e.g. align Cursor `start` with the reference adapter (session bootstrap only; defer model work to `send`), or document that duplicate runs are acceptable, or change engine spawn semantics in a follow-up ticket.

2. **major — Spec testing section not fully covered by plan tasks (spec: Testing; plan: Tasks 2–3).** The spec requires tests for: `start` with `initialInstructions` passes workspace + prompt args; CLI failure on `start`/`send` → `error` state + typed error code. The plan’s adapter tests cover idle, create-chat start, send/resume, invalid-state guards, stop/restart, but omit both rows. Add failing tests in Task 2 (initial-instructions argv assertions + `lastActivityAt` on start) and Task 3 (injected `run` rejects → `status().state === 'error'` and `AgentAdapterError` code).

3. **major — Task 2 interim implementation contains placeholder argv logic (plan: Task 2, Step 3).** The create-chat branch uses `this.deps.run([...(this.deps.binary ? [] : []), 'create-chat'])` — a no-op spread — plus a comment “implement in Task 4.” An implementer stopping after Task 2 could land dead code. Task 2 Step 3 should show the final shape `this.deps.run(['create-chat'])` (matching Task 3 Step 2’s explicit fix) so each task’s snippet is copy-runnable without deferred cleanup.

4. **minor — Constructor / factory shape differs from spec (spec: Dependency injection; plan: Task 2 + Task 4).** Spec: `constructor(deps?: CursorAgentDeps)` and example `new CursorAgentAdapter()`. Plan: required `constructor(deps: CursorAgentDeps)` plus `createCursorAgentAdapter(deps?)` factory. Functionally fine if the factory is the documented entry point, but the spec example will not compile as written. Align spec snippet or add `constructor(deps = createDefaultCursorAgentDeps())` in the plan.

5. **minor — File-structure name drift: `createCursorAgentRunner` vs `createDefaultCursorAgentDeps` (plan: File Structure table vs Task 4).** The table lists `createCursorAgentRunner`; Task 4 implements `createDefaultCursorAgentDeps`. Pick one name everywhere to avoid search/import confusion.

6. **minor — `stopping` state declared in spec status parity but unused (spec: Status Surface Parity; plan: Task 2 `stop`).** Spec says Cursor uses `starting`/`stopping` briefly around async CLI calls. Plan sets `starting` on `start` but `stop()` jumps straight to `stopped` with no `stopping` transition. Acceptable if brief `stopping` is best-effort, but worth a one-line note (as issue #33’s self-review did for unreachable states) or a `this.state = 'stopping'` guard before clearing session.

7. **minor — `lastActivityAt` not cleared on restart (plan: Task 2 `start` body; compare `ScriptedAgentAdapter.start`).** Reference adapter sets `this.lastActivityAt = undefined` on every successful `start`. Cursor plan only clears `errorMessage`. After `stop` → `start`, stale `lastActivityAt` from the prior session may remain until the next `send`. Add `this.lastActivityAt = undefined` at start (except when `initialInstructions` run sets it) and a restart assertion if parity matters.

8. **minor — `create-chat` production runner omits process `cwd` (plan: Task 4 `createDefaultCursorAgentDeps`).** `create-chat` runs as `execa(binary, ['create-chat'])` with no `cwd` option, while `--print` paths pass `--workspace`. If `cursor-agent` resolves auth or project context from the process working directory, session creation may not be tied to the worktree. Consider `execa(binary, ['create-chat'], { cwd: workingDirectory })` — requires threading `cwd` into the runner or storing it on deps before `create-chat` is called.

9. **nit — No per-task commit steps (compare `2026-06-01-issue-33-plan.md`).** Issue #33 plan ends each task with `git add` + `git commit`. This plan omits commits entirely. Not blocking, but workers using subagent-driven-development may want explicit commit boundaries.

10. **nit — Parser tests omit `session_id` missing case (plan: Task 1 tests; implementation throws for missing `session_id`).** Task 1 tests cover missing `result` but not missing `session_id`, though the implementation throws for both. Add a symmetric test for completeness.

11. **nit — Task 2 `invokeAgent` snippet declares unused `binary` (plan: Task 2, Step 3).** `const binary = this.deps.binary ?? 'cursor-agent'` is never used because binary is injected in Task 4’s default deps. Remove from the adapter snippet to avoid lint noise.

## What looks good

- **No `buildCursorLaunchPlan` regression:** Plan explicitly forbids edits to `src/adapters/cursor.ts`; Task 5 runs full `npm test` including existing `tests/unit/adapters.test.ts` expectations (`cursor-agent`, `--workspace`, worktree path, startup prompt).
- **create-chat vs `--print` split is correct:** create-chat = `['create-chat']` only, plain stdout → `sessionId`; headless work = `--print --trust --output-format json --workspace <cwd> …`; send adds `--resume <session_id>` before print flags. Matches spec CLI contract.
- **Argv/binary contract resolved in Task 4:** Adapter passes logical args without binary; `createDefaultCursorAgentDeps` owns `execa(binary, args)` and branches on `args[0] === 'create-chat'`. Task 3 Step 2 explicitly fixes the Task 2 create-chat branch — good, aside from finding #3.
- **Strict TDD on parser (Task 1):** Full red/green cycle with concrete test file, run command, and expected failure/pass counts.
- **Injectable I/O:** `fakeDeps` + `vi.fn` pattern matches spec’s testability goal; no network or subprocess in unit tests.
- **Dependency already present:** `execa` is in `package.json`; no new deps.
- **Test file layout:** Flat `tests/unit/cursor-agent-*.test.ts` matches post–issue-#33 convention (not a nested `agents/` folder).
- **Barrel export:** Task 4 extends `src/agents/index.ts` without disturbing existing type/scripted exports.

## Spec coverage table

| Spec requirement | Plan task | Status |
|------------------|-----------|--------|
| `CursorAgentAdapter` implements `AgentAdapter` | Tasks 2–4 | Covered |
| `parseCursorAgentJson` / JSON line parser | Task 1 | Covered |
| `CursorAgentDeps` with injectable `run` | Tasks 2–4 | Covered |
| `binary` defaults to `cursor-agent`, overridable | Task 4 | Covered |
| `start`: idle\|stopped → starting → running | Task 2 | Covered |
| `start` without `initialInstructions` → `create-chat` | Task 2 | Covered |
| `start` with `initialInstructions` → `--print` invocation | Task 2 (`invokeAgent`) | Implemented in snippet; **no test** (finding #2) |
| `send` → `--resume` + `--print` + workspace + prompt | Task 3 | Covered |
| `stop` no-op from idle/stopped; clears `session_id` | Task 2–3 | Implemented; idle no-op **not explicitly tested** |
| `status` snapshot with timestamps/error | Task 2 | Covered |
| CLI failure → `error` state + `AgentAdapterError` | Task 2–3 catch blocks | Implemented; **no test** (finding #2) |
| `lastActivityAt` on successful `send` and on `start` with instructions | Tasks 2–3 | Partial — send covered; start-with-instructions **untested** |
| Re-export from `src/agents/index.ts` | Task 4 | Covered |
| No changes to `src/adapters/cursor.ts` / `buildCursorLaunchPlan` | File structure, Task 5 | Covered |
| Engine `spawn` path compatibility | — | **Tension** (finding #1) |
| `tests/unit/cursor-agent-adapter.test.ts` lifecycle list | Tasks 2–3 | Partial — missing 2 spec rows |
| Optional `cursor-agent-cli.test.ts` | `cursor-agent-json.test.ts` | Acceptable rename/split |
| `starting`/`stopping` briefly around async calls | Task 2 `starting` only | Partial (finding #6) |
| `constructor(deps?)` optional | Task 2/4 | Mismatch (finding #4) |
