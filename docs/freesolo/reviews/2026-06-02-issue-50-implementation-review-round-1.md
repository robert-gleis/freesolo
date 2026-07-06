# Implementation Review — Issue #50, Round 1

## Status
pass

## Verification commands run
- `npm test`: PASS — 35 test files, 265 tests, all green (includes 5 parser + 10 adapter tests).
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `ensure-bin-executable.mjs` runs clean.
- `git diff src/adapters/cursor.ts`: empty — launch-plan builder unchanged.

## Findings

None actionable.

Optional observations (no changes required for this ticket):

1. **nit — `send` test does not assert all headless flags.** `tests/unit/cursor-agent-adapter.test.ts` verifies `--resume`, `--workspace`, and the prompt on the send path, but not `--print`, `--trust`, or `--output-format json`. The implementation in `src/agents/cursor.ts:111–120` includes all spec-required flags; add assertions only if flag regression coverage becomes a repo convention.

2. **nit — Cross-adapter edge cases not duplicated.** `tests/unit/scripted-agent-adapter.test.ts` covers `send` after `stop` → `invalid-state` and idempotent double-`stop`. The issue #50 spec Testing section does not list these cases; behaviour follows from the same state guards as `ScriptedAgentAdapter`.

3. **nit — Recovery from `error` state is implicit.** After a failed `start` or `send`, state is `error`; `start` from `error` throws `invalid-state` until `stop()` transitions to `stopped`. `stop()` from `error` is not explicitly tested but follows from the guard at `src/agents/cursor.ts:100`.

4. **nit — No engine + `CursorAgentAdapter` integration test.** Spec non-goals explicitly defer wiring into `freesolo start` or the workflow engine; engine spawn compatibility is architectural (existing `workflow-engine.test.ts` spawn tests use a fake adapter). Unit tests with injected `run` satisfy the spec.

## Acceptance criteria

| Criterion | Verdict | Evidence |
|-----------|---------|----------|
| Launch, stop, send, status through `AgentAdapter` | Met | `CursorAgentAdapter` implements all four methods; 10 lifecycle tests in `tests/unit/cursor-agent-adapter.test.ts` |
| Integrates with FreeSolo workflow (state transitions, event log) | Met | Engine `spawn` path (`src/workflow/engine.ts:174–178`) calls `start({ initialInstructions })` then `send(initialInstructions)`; adapter `start` ignores `initialInstructions` and runs `create-chat` only, avoiding double CLI invocation; event log remains engine-owned per spec |
| Same status surface as other adapters | Met | `AgentStatus` fields (`state`, `startedAt`, `lastActivityAt`, `error`) match `ScriptedAgentAdapter` in `src/agents/scripted.ts:75–80`; brief `starting`/`stopping` transitions are spec-intentional for async CLI |
| No regressions in existing Cursor-driven flows | Met | `src/adapters/cursor.ts` unchanged; `tests/unit/adapters.test.ts` (3 tests) green |

## Spec coverage

| Spec requirement | Status |
|------------------|--------|
| `parseCursorAgentJson` — last JSON line, `session_id` + `result` | Covered — 5 tests in `cursor-agent-json.test.ts` |
| `CursorAgentDeps` injectable `run`; optional `binary` | Covered — `fakeDeps` pattern; `createDefaultCursorAgentDeps(binary?)` |
| `start`: idle\|stopped → starting → running; `create-chat` with `cwd` | Covered — adapter + production runner |
| `start` ignores `initialInstructions` | Covered — dedicated test |
| `send`: `--resume` + `--print` + `--trust` + `--output-format json` + `--workspace` + prompt | Implemented; partial flag assertions in test (see observation #1) |
| `stop` no-op from idle/stopped; clears session; brief `stopping` | Covered |
| `status` snapshot with timestamps/error | Covered |
| CLI failure → `error` + `AgentAdapterError` (`start-failed` / `send-failed`) | Covered |
| `lastActivityAt` on send; cleared on `start` / restart | Covered |
| Barrel export from `src/agents/index.ts` | Covered |
| `constructor(deps?)` / `createCursorAgentAdapter()` | Covered |
| No changes to `src/adapters/cursor.ts` | Verified |

## What looks good

- **Plan fidelity:** Implementation matches the approved plan snippets task-for-task — parser, adapter lifecycle, production `execa` runner, and barrel exports.
- **Reference adapter parity:** `start` ignores `initialInstructions`; `lastActivityAt` cleared on `start`; `stop` no-op from `idle`; same `AgentStatus` shape as `ScriptedAgentAdapter`.
- **Engine spawn alignment:** Verified against `src/workflow/engine.ts:174–178` — one `create-chat` on `start`, one headless `--resume` on `send` with the initial prompt; no double model invocation.
- **Injectable I/O:** All adapter tests use `fakeDeps` + `vi.fn`; no subprocess or API key in CI.
- **Error semantics:** Failures transition to `error` state, populate `status().error`, and throw typed `AgentAdapterError` with correct codes.
- **Production runner:** `create-chat` uses `execa(binary, ['create-chat'], { cwd: options?.cwd })`; `--print` paths delegate to `parseCursorAgentJson(stdout)`.
