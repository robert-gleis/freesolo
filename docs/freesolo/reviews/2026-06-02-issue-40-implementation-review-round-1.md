# Implementation Review — Issue #40, Round 1

## Verdict
pass_with_findings

## Summary

`CodexAgentAdapter` is implemented per the approved design and plan: injectable `CodexInvoker`, pure `parseCodexExecJsonl`, default `execa` invoker with first-turn vs resume argv split, full lifecycle (`start`/`send`/`stop`/`status`), Codex-specific `error` state on failed `send`, and barrel exports in `src/agents/index.ts`. No workflow-engine source changes; spawn integration is covered by `codex-agent-workflow-integration.test.ts`. All 33 Codex unit tests pass; full suite (283 tests) and `npm run build` pass.

Parity with `ClaudeCodeAgentAdapter` (#39) is strong on lifecycle, cwd persistence, session continuity (`threadId`/`sessionId`), and default-invoker error mapping. Intentional deviations match spec/plan: `send` failure transitions to `error` with `status.error` set; `createDefaultInvoker` is exported for direct testing.

## Verification commands run

- `npx vitest run tests/unit/codex-*.test.ts`: PASS — 33 tests (4 files)
- `npm test`: PASS — 37 files, 283 tests
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Codex agents support the same workflow as Pi and Claude Code | Met | `start` + `send` + `stop` + `status`; workflow integration test asserts single invoker call on spawn, `toState`, and `decision`/`transition` events |
| Adapter status, logs, and lifecycle behave consistently | Met | Same `AgentStatus` fields; state machine matches Claude simplification (`idle\|stopped → running`, direct `→ stopped`); Codex adds documented `error` on failed `send` |
| No workflow-engine changes required | Met | `src/workflow/engine.ts` unchanged; spawn path `start` then `send` at lines 174–178 works with mock invoker |

## AgentAdapter contract

| Method | Compliance | Notes |
|---|---|---|
| `start(AgentStartInput)` | Yes | Validates cwd via `fs.access`; only from `idle`/`stopped`; does not invoke CLI; clears `threadId`, timestamps, and `errorMessage` |
| `send(string)` | Yes | Requires `running` + persisted `workingDirectory`; returns `{ output }`; resumes via stored `threadId` |
| `stop()` | Yes | No-op from `idle`/`stopped`; clears `threadId`; works from `running` and `error` |
| `status()` | Yes | Snapshot of `state`, `startedAt`, `lastActivityAt`, `error` |

Error codes used: `invalid-state`, `start-failed`, `send-failed` — all within `AgentAdapterErrorCode`.

## Test coverage

| Area | File | Cases |
|---|---|---|
| JSONL parser | `codex-exec-json.test.ts` | Happy path, last-message wins, empty/whitespace stdout, missing `thread_id`/`agent_message`, `turn.failed`, fatal `error`, transient `Reconnecting` |
| Adapter lifecycle | `codex-agent-adapter.test.ts` | Idle, start (no invoke), `start-failed`, double-start, start-from-stopped, stop no-op/idempotent, `lastActivityAt` reset on restart |
| Send + error state | `codex-agent-adapter.test.ts` | Thread resume, `lastActivityAt`, invalid-state guards, error transition, no retry after error, `AgentAdapterError` rethrow, wrap generic errors, send-after-stop |
| Stop from error | `codex-agent-adapter.test.ts` | Error → stop → stopped; threadId cleared on restart |
| Default invoker | `codex-default-invoker.test.ts` | First-turn argv (`--skip-git-repo-check`), resume argv (no skip flag), non-zero exit, parser failure wrap |
| Engine integration | `codex-agent-workflow-integration.test.ts` | Spawn tick: one invoker call, agent stays `running`, state transition + events |

No live CLI tests in CI — correct per spec.

## Engine isolation

- `src/agents/codex.ts` imports only `node:fs/promises`, `execa`, and `./types.js` — no workflow, policy, or command-layer imports.
- `src/adapters/codex.ts` (`buildCodexLaunchPlan`) untouched — correct non-goal.
- Injectable `CodexInvoker` boundary keeps subprocess I/O out of adapter state machine logic.

## Parity vs Claude (#39)

| Aspect | Claude | Codex | Assessment |
|---|---|---|---|
| Lifecycle states | `idle\|stopped → running` | Same | Aligned |
| `start` never invokes | Yes | Yes | Aligned |
| `workingDirectory` on `start` | Persisted | Persisted | Aligned |
| Session continuity field | `sessionId` | `threadId` | Aligned (CLI-specific) |
| `send` failure → `error` state | No (throws only) | Yes | Intentional per spec |
| `createDefaultInvoker` export | Private | Exported | Intentional per plan (direct test) |
| Barrel exports | Class + types | Class + types + parser + invoker factory | Slightly broader; acceptable |

## Critical

None.

## Major

None.

## Minor

1. **`start` from `error` without `stop` is untested (spec: preconditions `idle` or `stopped` only).** Implementation correctly rejects at `src/agents/codex.ts:121–123` when `state === 'error'`, but no test asserts `invalid-state` on `start()` while in `error`. Low risk — guard is symmetric with double-start — but worth one assertion for state-machine documentation.

2. **`status.error` not asserted cleared after `start` following error → stop → start.** `start` clears `errorMessage` at line 136 (matches `ScriptedAgentAdapter`); plan review round 2 flagged this as optional coverage. Implementer got it right; a single test would lock parity with scripted/Claude patterns.

3. **`parseCodexExecJsonl` silently skips non-JSON lines (`catch { continue }` at lines 43–45).** Not specified in design; benign for noise lines but could mask partially corrupt stdout if later valid lines still yield `thread_id` + `agent_message`. Consider a one-line comment or a fixture test documenting the tolerance.

## Nit

1. **`stop from error` test uses a second adapter instance** (`codex-agent-adapter.test.ts:212–220`) to assert fresh-session behavior instead of `error → stop → start → send` on the same adapter. Thread-clear on restart is covered by a separate test; combining would strengthen the error-recovery story.

2. **Integration test filename vs design architecture block.** Design lists `codex-workflow-integration.test.ts`; shipped file is `codex-agent-workflow-integration.test.ts` (matches #39 adapter-prefixed convention). No functional impact.

3. **`stop()` does not clear `errorMessage`.** After `error → stop`, `status()` may still expose `error` until the next `start`. Matches Claude's field retention pattern; spec silent on this — acceptable.

## What looks good

- TDD-shaped deliverable: parser → lifecycle → send/invoker → integration; all plan test cases present.
- Default invoker argv split (`--skip-git-repo-check` first turn only) matches design and enables temp-dir testing without git repos.
- `AgentAdapterError` rethrow path preserves upstream instance while still recording `error` state — tested explicitly.
- Workflow spawn assertion (exactly one invoker call with `threadId: undefined`) correctly reflects engine calling `send` once on spawn, not `start` auto-sending.
- Export surface in `index.ts` mirrors Claude barrel pattern and includes types needed for injection/testing.
