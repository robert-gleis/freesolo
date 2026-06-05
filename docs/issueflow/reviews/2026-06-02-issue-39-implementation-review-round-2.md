# Implementation Review — Issue #39, Round 2

## Status
pass

## Verification commands run
- `npm test`: PASS — 35 test files, 267 tests, all green. Claude adapter contributes 16 unit tests (`claude-code-agent-adapter.test.ts`, +3 since round 1) and 1 integration test (`claude-code-workflow-integration.test.ts`).
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `dist/src/agents/claude-code.js` emitted; `ensure-bin-executable.mjs` runs clean.

## Round 1 findings — resolution

| # | Round 1 finding | Severity | Round 2 status |
|---|---|---|---|
| 1 | `ScriptedAgentAdapter` parity tests absent (`send` after `stop`, `clears lastActivityAt on restart`) | Minor | **Resolved.** `tests/unit/claude-code-agent-adapter.test.ts:138-144` adds `rejects send after stop`; `tests/unit/claude-code-agent-adapter.test.ts:177-187` adds `clears lastActivityAt on restart`. Mirrors `scripted-agent-adapter.test.ts:148-158` and `:178-189`. |
| 2 | Integration test asserts `transition` presence but not full event sequence | Minor | **Resolved.** `tests/unit/claude-code-workflow-integration.test.ts:39` now uses `expect(eventKinds).toEqual(['decision', 'transition'])`, matching `workflow-engine.test.ts:349`. |
| 3 | Spec documents `error` state in `stop()` / `status()` but adapter throws on failure | Nit | **Acknowledged, no change.** Same intentional simplification as `ScriptedAgentAdapter` (#33). Consistent with repo; spec note only. |
| 4 | Default invoker and `binary` option not unit-tested | Nit | **Acknowledged, acceptable.** Injectable boundary is the primary test seam; no live CLI in CI per spec. |
| 5 | `AgentAdapterError` passthrough on `send` not explicitly tested | Nit | **Resolved.** `tests/unit/claude-code-agent-adapter.test.ts:125-136` adds `rethrows AgentAdapterError from invoker unchanged`. |

All actionable round 1 items (findings 1, 2, 5) are addressed. Remaining nits (3, 4) were explicitly non-blocking in round 1 and require no further work for merge.

## Acceptance criteria (re-verified)
- **Claude Code sessions launched via adapter** — Met. `start` validates `cwd` and enters `running` without invoking; `send` drives injectable `ClaudeInvoker` with optional `sessionId` resume. Default invoker runs `claude -p <prompt> --output-format json` with `--resume` when a session exists (`src/agents/claude-code.ts:109-125`).
- **Integrates with IssueFlow workflow** — Met. Integration test wires `createWorkflowEngine` with mock invoker on spawn path; asserts one invoke, adapter `running`, and full `['decision', 'transition']` event sequence.
- **Same status surface as other adapters** — Met. `status()` returns same `AgentStatus` snapshot shape as `ScriptedAgentAdapter`. Lifecycle semantics align with #33 reference adapter; parity tests now lock `send`-after-`stop` and `lastActivityAt` restart behavior.

## Spec alignment (`src/agents/claude-code.ts` vs `docs/issueflow/specs/2026-06-02-issue-39-design.md`)

| Spec requirement | Implementation | Status |
|---|---|---|
| `ClaudeInvoker` / `ClaudeInvokeInput` / `ClaudePrintJson` types | Lines 14-28 | Match |
| Constructor `binary?`, `invoker?` | Lines 44-46 | Match |
| `start`: `idle`/`stopped` only; `invalid-state` otherwise | Lines 49-51 | Match |
| `start`: cwd access → `start-failed` | Lines 52-58 | Match |
| `start`: no Claude invoke | Lines 60-65 (no invoker call) | Match |
| `start`: clears `lastActivityAt`, `sessionId` on (re)start | Lines 63-65 | Match |
| `send`: `running` precondition | Lines 75-77 | Match |
| `send`: pass `sessionId`, store returned `session_id` | Lines 80-84, 95 | Match |
| `send`: reject `is_error` / missing `result` → `send-failed` | Lines 92-94 | Match |
| `send`: update `lastActivityAt` on success | Line 96 | Match |
| `send`: `session_id` not stored on failed payload (validated before store) | Lines 92-95 order | Match |
| `stop`: no-op from `idle` / `stopped` | Lines 69-71 | Match |
| `stop`: clears `sessionId`, sets `stopped` from `running` | Lines 70-71 | Match |
| `status()`: snapshot with optional fields omitted when unset | Lines 100-105 | Match |
| Default invoker: `-p`, `--output-format json`, optional `--resume` | Lines 111-112 | Match |
| Default invoker: `reject: false`, non-zero → `send-failed` | Lines 113-118 | Match |
| Default invoker: invalid JSON → `send-failed` | Lines 120-124 | Match |
| Barrel exports in `src/agents/index.ts` | Lines 14-20 | Match |
| No engine imports of `claude-code.ts` | Verified — no matches under `src/workflow/` | Match |

No spec deviations introduced since round 1.

## Contract / bug check
- **No double-prompt on spawn.** Unchanged and correct.
- **Session resume.** First `send` omits `sessionId`; subsequent passes stored id; `stop` clears so restart omits resume. Tested.
- **Error codes.** `invalid-state`, `start-failed`, `send-failed` match spec table. `stop` never throws on no-op paths.
- **Engine isolation.** Integration test remains the only workflow touchpoint.

## New findings (round 2)
None. No critical, important, or minor defects identified beyond the resolved round 1 items.

## What looks good
- Round 1 actionable feedback applied cleanly with minimal, targeted test additions (+3 tests).
- Implementation unchanged and still matches plan skeleton; no scope creep.
- Test parity with `ScriptedAgentAdapter` now covers the two lifecycle edge cases round 1 flagged.
- Integration test event assertion now matches established engine-test convention.
- `AgentAdapterError` rethrow path is explicitly locked, closing the last untested error branch noted in round 1.

STATUS=pass
