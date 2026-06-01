# Implementation Review — Issue #33, Round 2

## Status
pass

## Verification commands run
- `npm test`: PASS — 17 test files, 90 tests, all green. New work contributes 5 tests (`agent-adapter-types.test.ts`) and 15 tests (`scripted-agent-adapter.test.ts`), unchanged from round 1.
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `dist/src/agents/{index,scripted,types}.js` are emitted; `ensure-bin-executable.mjs` runs clean.

## Round 1 follow-up
- Finding 1 (spec drift on test directory layout) — addressed. `docs/issueflow/specs/2026-06-01-issue-33-design.md:147-150` now says "Unit tests live under `tests/unit/` (flat, matching existing repo convention)" and lists `agent-adapter-types.test.ts` / `scripted-agent-adapter.test.ts`, matching what's on disk.
- Finding 2 (nit: redundant assignment in `stop()`) — addressed. `src/agents/scripted.ts:45` now early-returns from both `idle` and `stopped`: `if (this.state === 'idle' || this.state === 'stopped') return;`. Idempotency test on `tests/unit/scripted-agent-adapter.test.ts:60` still passes.
- Finding 3 (nit: `AgentStartInput.workingDirectory` unread by reference adapter) — visibility-only flag in round 1; no action required, and none taken. Intentional for a deterministic test double.

## New findings

None. On a second pass with the round-1 fixes in place, the implementation matches the spec, the test list, and the repo's existing conventions. The trivial-adapter design (no `starting`/`stopping`/`error` transitions because there is no subprocess to make them observable) is explicitly captured in the spec at `docs/issueflow/specs/2026-06-01-issue-33-design.md:135`, so it is not a coverage gap.

## What looks good
- All 10 behavioral assertions enumerated in the spec's Testing section (`docs/issueflow/specs/2026-06-01-issue-33-design.md:150-160`) have a corresponding test in `tests/unit/scripted-agent-adapter.test.ts` — including the often-skipped "send after stop" case (line 148) and the "lastActivityAt cleared on restart" case (line 178).
- Round-1 fix to `stop()` makes the early-return read declaratively as "from idle or stopped, this is a no-op," which is exactly the spec language at `docs/issueflow/specs/2026-06-01-issue-33-design.md:89`.
- `AgentAdapterError` carries the discriminant `code` and a string message; tests assert both the `instanceof Error` invariant and every documented `code` value, so future adapters extending the error set inherit the same contract shape.
- Barrel `src/agents/index.ts` re-exports types with `export type` and the class/error as runtime exports; consumers (future engine code) can import the entire public surface from `./agents/index.js`.
- Commit history reads cleanly as a TDD trail: skeleton → start → stop → send happy path → send failure paths → reuse after stop → barrel → round-1 fixes. Easy to bisect.
- `tests/unit/agent-adapter-types.test.ts` doubles as a compile-time pin on the `AgentState` union (line 37) — if a future change reshuffles or extends the union, this test forces a deliberate update.
