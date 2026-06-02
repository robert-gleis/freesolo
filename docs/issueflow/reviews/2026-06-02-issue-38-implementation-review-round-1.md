# Implementation Review — Issue #38, Round 1

## Status
pass_with_findings

## Verification commands run
- `npm test`: PASS — 36 test files, 274 tests, all green. New work contributes 9 tests (`pi-rpc.test.ts`), 13 tests (`pi-agent-adapter.test.ts`), and 2 tests (`pi-engine-isolation.test.ts`).
- `npm run build`: PASS — `tsc -p tsconfig.json && node ./scripts/ensure-bin-executable.mjs ./dist/src/bin.js` exits 0.

## Acceptance criteria
- **Pi agents can be spawned via the adapter** — Met. `PiAgentAdapter.start()` spawns via injectable `transportFactory` (default `createNodePiTransport`) with argv `['--mode', 'rpc', '--offline', '--no-session']`, binary `options.binary ?? 'pi'`, and `cwd: input.workingDirectory` (`src/agents/pi.ts:118-129`). Covered by `tests/unit/pi-agent-adapter.test.ts` spawn capture test.
- **Adapter tracks agent status (idle / running / finished / errored)** — Met. Lifecycle states map per design: `idle`, `starting`, `running`, `stopping`, `stopped`, `error` (`src/agents/pi.ts:84-196`). Issue terms map as designed (`stopped` = finished, `error` = errored). Transitional `starting`/`stopping`, process-exit→`error`, and `start-failed`/`send-failed` paths are implemented and tested.
- **Adapter captures logs consumable by the event log** — Partially met. `readLogs()` returns `AgentLogSnapshot` with all four fields (`src/agents/pi.ts:199-201`, `src/agents/log-snapshot.ts`). Ring buffer, truncation flag, and stdout capture work. Findings 1 and 4 below cover combined-byte cap enforcement and stderr test coverage gaps.
- **Injectable transport / no live Pi in CI** — Met. `createInMemoryPiTransport` + `transportFactory` drive all adapter unit tests; no real `pi` binary required.
- **JSONL framing (`\n` only, no readline)** — Met. `splitJsonlLines` / `parsePiLine` in `src/agents/pi-rpc.ts` with edge-case tests in `tests/unit/pi-rpc.test.ts`.
- **Headless extension UI auto-cancel** — Met. `PiRpcSession.handleStdoutLine` writes `extension_ui_response` with `cancelled: true` for dialog methods (`src/agents/pi-rpc.ts:159-167`); tested in `pi-rpc.test.ts`.
- **`initialInstructions` via first RPC `prompt`, not CLI flag** — Met (`src/agents/pi.ts:142-144`); tested in `pi-agent-adapter.test.ts`.
- **Engine isolation (no `src/workflow/` imports of pi modules)** — Met today (`rg` shows no matches). Regression test exists but Finding 3 notes incomplete coverage of `pi-rpc` import paths per plan Task 5.

## Findings

1. **Important — Log ring buffer does not enforce the documented combined byte cap** (`src/agents/pi.ts:59-70`). Design and plan specify a default **1 MiB combined** cap with `truncated: true` when exceeded. `LogRingBuffer.append` sets `truncated` when `stdout.length + stderr.length + chunk.length > maxBytes`, but each stream is trimmed independently with `next.slice(-this.maxBytes)`. With both streams active, retained bytes can exceed `maxBytes` (e.g. cap 32, 20 bytes stdout + 20 bytes stderr → 52 bytes retained). **Suggested fix:** trim against combined length (single ring or proportional eviction) and add a test that asserts `stdout.length + stderr.length <= maxLogBytes` after overflow.

2. **Important — `createNodePiTransport` does not surface spawn failures** (`src/agents/pi-rpc.ts:265-282`). `child_process.spawn` emits an `error` event when the binary is missing; that event is not wired. `spawn()` resolves immediately, so `PiAgentAdapter.start()` transitions to `running` even when `pi` is absent on PATH. The default constructor path (no `transportFactory`) is affected; unit tests mask this because they inject the in-memory transport. **Suggested fix:** wrap spawn in a Promise that rejects on the first `error` event (and optionally on immediate non-zero exit before RPC is ready).

3. **Important — Engine isolation test omits `pi-rpc` import paths** (`tests/unit/pi-engine-isolation.test.ts:21-22`). Plan Task 5 Step 1b requires failing on imports of `/agents/pi`, `pi-rpc`, or `PiAgentAdapter`. The regex `/agents\/pi(?:\/[^'"]*)?` matches `/agents/pi` but not `/agents/pi-rpc.js` (the next character after `pi` is `-`, not `/` or `'`), so a workflow file could import `pi-rpc` without tripping the test. **Suggested fix:** add a `pi-rpc` path alternative to the regex (mirror `runner-engine-isolation.test.ts` coverage breadth).

4. **Minor — `readLogs()` stderr accumulation not asserted** (plan Task 3 Step 16; `tests/unit/pi-agent-adapter.test.ts:218-238`). The adapter wires `transport.onStderr` into the ring buffer (`src/agents/pi.ts:211-213`), but the only log test pushes stdout. Add a test that emits stderr and asserts `logs.stderr`, `logs.combined` contains `[stderr]`, and stream tagging.

5. **Minor — Double `start()` without `stop()` not tested** (plan Task 3 Step 12; compare `tests/unit/scripted-agent-adapter.test.ts:30-38`). Implementation correctly throws `invalid-state` (`src/agents/pi.ts:99-104`). Add a test mirroring the scripted adapter guard so regressions are caught.

6. **Nit — `startedAt` not explicitly pinned after `start()`** (plan Task 3 Step 12). `send` test checks `lastActivityAt` but no test asserts `status().startedAt` is a `Date` immediately after `start()`. Low risk given adjacent coverage; one-line assertion would close the plan checklist.

## What looks good
- **Layering matches the design.** JSONL/RPC plumbing (`pi-rpc.ts`), lifecycle adapter (`pi.ts`), and log types (`log-snapshot.ts`) are cleanly separated; `PiAgentAdapter` depends on `AgentAdapter` from `types.ts` only for the shared contract.
- **TDD coverage on the fake transport path is strong.** 13 adapter tests cover spawn argv, `initialInstructions`→prompt, transitional `starting`/`stopping`, `start-failed`, `send-failed`, idempotent `stop`, reuse-after-stop, process exit→`error`, truncation flag, and structural `AgentAdapter` conformance.
- **`PiRpcSession` protocol handling is sound.** Prompt waits for `agent_end`, correlates optional RPC `id`, queues concurrent prompts via `pendingPrompt`, and auto-cancels extension UI dialogs without blocking headless runs.
- **Barrel exports are correct.** `src/agents/index.ts` re-exports `PiAgentAdapter`, `createInMemoryPiTransport`, log types, and options with `export type` for type-only symbols — workflow code can import from one path when wired later.
- **Production transport matches design teardown.** `createNodePiTransport.kill()` sends SIGTERM then SIGKILL after 2s (`src/agents/pi-rpc.ts:287-302`), aligned with design §`stop`.
- **No workflow coupling.** `src/workflow/` contains zero imports of pi modules today; engine remains agent-agnostic per epic constraint.
- **NodeNext conventions held.** `.js` import suffixes, `type` imports, and vitest layout under flat `tests/unit/` match existing repo patterns.
