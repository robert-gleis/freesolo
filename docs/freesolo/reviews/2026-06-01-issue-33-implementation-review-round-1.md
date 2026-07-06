# Implementation Review — Issue #33, Round 1

## Status
pass_with_findings

## Verification commands run
- `npm test`: PASS — 17 test files, 90 tests, all green. New files contribute 5 tests (`agent-adapter-types.test.ts`) and 15 tests (`scripted-agent-adapter.test.ts`), matching the plan's self-review count.
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `dist/src/agents/{index,scripted,types}.js` are emitted.

## Acceptance criteria
- **No agent-specific logic in the workflow engine** — Met (vacuously, with forward-looking guardrail). `src/workflow/kernel.ts` contains no imports from `src/agents/` and no agent-specific logic; the spec records the constraint that future engine code may import only from `src/agents/index.ts`.
- **Interface covers start / stop / send / status** — Met. `AgentAdapter` in `src/agents/types.ts:25-30` declares all four methods with the signatures specified in the spec (`start(input)`, `stop()`, `send(input)`, `status()`), all returning `Promise`.
- **At least one adapter validates the interface** — Met. `ScriptedAgentAdapter` in `src/agents/scripted.ts:20` implements `AgentAdapter`, is exercised by 15 unit tests covering every state transition and error path the spec calls out, and is re-exported from the barrel for future engine tests.

## Findings

1. **Minor — Spec drift on test directory** (`docs/freesolo/specs/2026-06-01-issue-33-design.md:147`, `tests/unit/`). Spec says "Unit tests live under `tests/unit/agents/`," but the plan and implementation use the flat `tests/unit/*.test.ts` layout (`agent-adapter-types.test.ts`, `scripted-agent-adapter.test.ts`). The flat layout matches every other test file in the repo (see `tests/unit/adapters.test.ts`, `tests/unit/workflow.test.ts`, etc.), so the plan correctly normalised to the existing convention. No code change needed — either update the spec to reflect the flat layout, or accept the deviation as a documentation nit.

2. **Nit — `stop()` redundant assignment from `stopped`** (`src/agents/scripted.ts:44-47`). Implementation:
   ```ts
   async stop(): Promise<void> {
     if (this.state === 'idle') return;
     this.state = 'stopped';
   }
   ```
   When `state === 'stopped'`, the function does not early-return; it re-assigns `state = 'stopped'`. Behaviourally identical to a no-op (test on line 60 of `scripted-agent-adapter.test.ts` confirms idempotency), but the early return could also cover the `'stopped'` case for clarity, e.g. `if (this.state === 'idle' || this.state === 'stopped') return;`. Not worth blocking.

3. **Nit — `AgentStartInput.workingDirectory` never read by the reference adapter** (`src/agents/scripted.ts:31`). `start(_input)` accepts and discards the input. This is intentional for a deterministic test double, and the `_` prefix signals it. No action needed — flagged only so it shows up in review for visibility.

## What looks good
- TDD discipline is visible in the commit history: one task = one commit, tests added before implementation, with separate commits for `start`, `stop`, `send` happy path, `send` failure paths, and reuse-after-stop.
- Imports use NodeNext `.js` extensions consistently across `src/agents/{index,scripted,types}.ts` and both test files.
- Type-only imports are correctly marked with `type` (`type AgentAdapter`, `type AgentResponse`, etc.) in both `scripted.ts` and the test files.
- `AgentStatus` snapshot construction in `status()` is defensive: it only attaches `startedAt`/`lastActivityAt`/`error` when they have values, so callers that destructure won't see `undefined` properties they didn't expect.
- Barrel module `src/agents/index.ts` exports exactly the surface the spec describes — types are re-exported with `export type`, the class and error are runtime-exported — so consumers can import everything from one path.
- `start()` clears `lastActivityAt` and `errorMessage` on restart, which the dedicated "clears lastActivityAt on restart" test pins. This will matter when real adapters land and the reference adapter is reused as a fixture across test cases.
- `matches()` is a private file-local helper with an inline comment explaining the string-vs-RegExp semantics, mirroring the spec's `ScriptStep.match` doc. No leakage into the public surface.
- The spec's intentional decision not to exercise `starting`/`stopping`/`error` states in the reference adapter (because there is no async subprocess work to make those observable) is explicitly captured in the plan's self-review section and is not a coverage gap.
