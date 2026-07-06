# Implementation Review — Issue #39, Round 1

## Status
pass_with_findings

## Verification commands run
- `npm test`: PASS — 35 test files, 264 tests, all green. New work contributes 13 tests (`claude-code-agent-adapter.test.ts`) and 1 test (`claude-code-workflow-integration.test.ts`), matching the plan's Task 1–3 scope.
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `dist/src/agents/claude-code.js` is emitted alongside `index.js`, `scripted.js`, and `types.js`; `ensure-bin-executable.mjs` runs clean.

## Acceptance criteria
- **Claude Code sessions launched via adapter** — Met. `ClaudeCodeAgentAdapter.start` validates `cwd` and enters `running` without invoking; `send` drives the injectable `ClaudeInvoker` with optional `sessionId` resume. Default invoker runs `claude -p <prompt> --output-format json` with `--resume` when a session exists (`src/agents/claude-code.ts:109-125`).
- **Integrates with FreeSolo workflow** — Met. `tests/unit/claude-code-workflow-integration.test.ts` wires `createWorkflowEngine` with a mock invoker on the `spawn` path; asserts one invoke with spawn prompt, adapter remains `running`, and a `transition` event is emitted.
- **Same status surface as other adapters** — Met. `status()` returns the same `AgentStatus` snapshot shape as `ScriptedAgentAdapter` (`state`, optional `startedAt` / `lastActivityAt` / `error`). Lifecycle semantics (`idle` → `running` → `stopped`, restart from `stopped`, idle no-op on `stop`) align with the #33 reference adapter.

## Plan alignment
| Plan task | Status |
|---|---|
| Task 1 — lifecycle, cwd validation, exports | Complete |
| Task 2 — `send`, session resume, `stop` semantics | Complete |
| Task 3 — workflow integration test | Complete |
| Task 4 — `npm test` + `npm run build` | Complete (verified locally; changes not yet committed) |

## Findings

1. **Minor — `ScriptedAgentAdapter` parity tests absent (`tests/unit/claude-code-agent-adapter.test.ts`).** The reference adapter pins two behaviors the Claude adapter implements but does not lock:
   - `send` after `stop` → `invalid-state` (`scripted-agent-adapter.test.ts:148-158`)
   - `clears lastActivityAt on restart` (`scripted-agent-adapter.test.ts:178-189`)

   `start()` already sets `lastActivityAt = undefined` on restart (`claude-code.ts:63`), and `send` guards on `state !== 'running'`, so behavior should be correct. Adding the two tests would close parity with #33 and prevent regressions. Not blocking.

2. **Minor — Integration test asserts `transition` presence but not full event sequence (`tests/unit/claude-code-workflow-integration.test.ts:39`).** `workflow-engine.test.ts` spawn happy path expects `['decision', 'transition']`. The integration test uses `expect(eventKinds).toContain('transition')`, which satisfies the plan acceptance row but is weaker than the established engine-test pattern. Tightening to `expect(eventKinds).toEqual(['decision', 'transition'])` would mirror `workflow-engine.test.ts:349`. Optional polish.

3. **Nit — Spec documents `error` state in `stop()` / `status()` but adapter throws on failure (`docs/freesolo/specs/2026-06-02-issue-39-design.md:98,103`; `claude-code.ts:39,104`).** `errorMessage` is declared and surfaced in `status()` when set, but `send` failures propagate as thrown `AgentAdapterError` without entering `error` state — same intentional simplification as `ScriptedAgentAdapter` (#33). Consistent with the repo; no code change required unless the spec is tightened later.

4. **Nit — Default invoker and `binary` option are not unit-tested (`claude-code.ts:44-45,109-125`).** All tests inject a mock `ClaudeInvoker`, which matches the spec's "no live CLI tests in CI" constraint. Custom `binary` passthrough to execa is untested; acceptable for v1 given the injectable boundary is the primary test seam.

5. **Nit — `AgentAdapterError` passthrough on `send` is implemented but not explicitly tested (`claude-code.ts:86`).** When the invoker throws an existing `AgentAdapterError` (e.g. default invoker non-zero exit), `send` re-throws unchanged. Only the generic `Error('boom')` wrapping path is tested. Low risk; optional test for completeness.

## Contract / bug check
- **No double-prompt on spawn.** `start` does not invoke; engine `spawn` path calls `start` then `send` once (`engine.ts:174-178`). Integration test pins exactly one invoker call. Correct.
- **Session resume.** First `send` omits `sessionId`; subsequent `send` passes stored `session_id`; `stop` clears session so restart omits resume. Tested.
- **Error codes.** `invalid-state`, `start-failed`, `send-failed` match spec table. `stop` never throws on no-op paths.
- **Barrel exports.** `src/agents/index.ts` re-exports `ClaudeCodeAgentAdapter`, options, and invoker types with `export type` for type-only symbols. Matches plan.
- **Engine isolation.** No imports of `claude-code.ts` from `src/workflow/`; integration test is the only workflow touchpoint. Matches ADR / #33 guardrail.

No critical or important defects found. Nothing blocks merge.

## What looks good
- Implementation matches the plan's code skeleton almost line-for-line; no scope creep or engine changes.
- TDD coverage is thorough for lifecycle, send happy/error paths, session resume, stop semantics, and cwd validation.
- `createDefaultInvoker` uses `reject: false` and maps non-zero exit and invalid JSON to `send-failed` with stderr/stdout excerpt, as spec'd.
- `send` validates `is_error` before updating `sessionId`, so a failed payload does not poison session continuity.
- Imports use NodeNext `.js` extensions; type-only imports are marked `type` in tests and implementation.
- `status()` snapshot construction is defensive — optional fields omitted when unset, matching `ScriptedAgentAdapter`.
- Injectable `ClaudeInvoker` boundary keeps subprocess I/O fully mockable; all 14 new tests run without the real `claude` binary.

STATUS=pass_with_findings
