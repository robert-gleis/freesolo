# Implementation Review — Issue #38, Round 2

## Status
pass

## Verification commands run
- `npm test`: PASS — 36 test files, 276 tests, all green (+2 vs round 1: double-start guard, stderr log accumulation).
- `npm run build`: PASS — `tsc -p tsconfig.json && node ./scripts/ensure-bin-executable.mjs ./dist/src/bin.js` exits 0.

## Round 1 finding verification

| # | Severity (R1) | Finding | Fixed? | Evidence |
|---|---------------|---------|--------|----------|
| 1 | Important | Log ring buffer did not enforce combined byte cap | Yes | `LogRingBuffer.enforceCap()` evicts from the longer stream until `stdout.length + stderr.length <= maxBytes` (`src/agents/pi.ts:61-78`). Test asserts combined length ≤ cap after overflow (`tests/unit/pi-agent-adapter.test.ts:251`). |
| 2 | Important | `createNodePiTransport` did not surface spawn failures | Yes | `spawn()` wraps `child_process.spawn` in a Promise that rejects on `error` and resolves on `nextTick` only when `child` is still set (`src/agents/pi-rpc.ts:272-299`). `PiAgentAdapter.start()` catches and maps to `start-failed` / `error` state (`src/agents/pi.ts:130-141`). |
| 3 | Important | Engine isolation test omitted `pi-rpc` import paths | Yes | Regex now matches `/agents/pi-rpc` alongside `/agents/pi` and `PiAgentAdapter` (`tests/unit/pi-engine-isolation.test.ts:21-22`). |
| 4 | Minor | `readLogs()` stderr accumulation not asserted | Yes | New test emits stderr and asserts `logs.stderr`, `logs.combined` contains `[stderr]` (`tests/unit/pi-agent-adapter.test.ts:254-270`). |
| 5 | Minor | Double `start()` without `stop()` not tested | Yes | New test mirrors scripted adapter guard (`tests/unit/pi-agent-adapter.test.ts:57-67`). |
| 6 | Nit | `startedAt` not pinned after `start()` | Yes | Spawn test asserts `startedAt` is a `Date` immediately after start (`tests/unit/pi-agent-adapter.test.ts:54`). |

All six round 1 findings are addressed in code. No regressions identified.

## Acceptance criteria (re-check)
- **Pi agents can be spawned via the adapter** — Met. Unchanged from round 1; spawn argv, cwd, and injectable transport verified by tests.
- **Adapter tracks agent status** — Met. Lifecycle states, transitional `starting`/`stopping`, exit→`error`, and invalid-state guards covered (15 adapter tests).
- **Adapter captures logs consumable by the event log** — Met. Combined-byte cap now enforced; stdout, stderr, combined tagging, and `truncated` flag all tested.
- **Injectable transport / no live Pi in CI** — Met.
- **JSONL framing** — Met (`pi-rpc.test.ts`, 9 tests).
- **Headless extension UI auto-cancel** — Met.
- **`initialInstructions` via first RPC `prompt`** — Met.
- **Engine isolation** — Met. No workflow imports; isolation regex covers `pi-rpc` paths.

## Findings
None. No code changes required before merge.

## Observations (non-blocking)
- Finding 2 (spawn failure surfacing) is fixed in production transport code but has no dedicated unit test that rejects `transport.spawn()` and asserts `start-failed`. Existing `start-failed` coverage uses inaccessible cwd only. Acceptable for v1; a fake transport that rejects on spawn would close the loop if desired later.
- Combined-cap regression test exercises stdout overflow only; `enforceCap()` logic handles both streams symmetrically and the assertion checks combined length.

## What looks good
- Round 1 feedback was applied precisely — no scope creep, no unrelated refactors.
- Log buffer eviction is correct: proportional trim by evicting from the longer stream preserves the documented combined cap.
- Spawn error wiring follows Node.js conventions (`error` event + deferred resolve guard).
- Test count and coverage align with plan Task 3 checklist items that were previously open.
