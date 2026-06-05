# Plan Review — Issue #38, Round 1

## Status
pass_with_findings

## Verification commands run
- `rg 'from.*pi|/agents/pi' src/workflow` — 0 matches (engine isolation premise holds today)
- `ls src/agents/ tests/unit/pi*.test.ts` — planned `pi*.ts` / `pi*.test.ts` files not present yet (expected pre-implementation)
- `npx tsc -p tsconfig.json` — PASS (baseline compiles)
- `npx vitest run` — PASS (114 tests, 0 failures; baseline suite green)
- `npm run build` — FAIL (`tsc` not on PATH; use `npx tsc` or `npm ci` first)

## Acceptance criteria / spec alignment
- **Pi agents can be spawned via the adapter** → Task 3 (`start()` with injectable `transportFactory`) + Task 4 (`createNodePiTransport` / default constructor). Plan asserts `--mode rpc` in spawn args; spec also requires `--offline` and `--no-session` (see Finding 1).
- **Adapter tracks agent status (idle / running / finished / errored)** → Task 3 lifecycle tests mirror `scripted-agent-adapter.test.ts` (`idle`, `running`, `stopped`, invalid-state paths). Spec maps finished→`stopped`, errored→`error`; plan covers error paths in Step 8 but does not pin process-exit→`error` or `status().error` after `start-failed` (Finding 4).
- **Adapter captures logs consumable by the event log** → Task 1 (`AgentLogSnapshot` fields match Runner `LogSnapshot`) + Task 3 Steps 10–11 (`readLogs()` ring buffer). `sinceByteOffset` reserved per spec; truncation flag called out in spec testing section but only stdout accumulation is explicit in plan Step 10 (Finding 5).
- **Injectable transport / no live Pi in CI** → Task 2 `createInMemoryPiTransport` + Task 3 `transportFactory`; Task 4 keeps tests on fake factory. Aligned.
- **JSONL framing (`\n` only, no readline)** → Task 2 Steps 1–3 with U+2028 and `\r\n` cases. Aligned.
- **Headless extension UI auto-cancel** → Task 2 Steps 4–5. Aligned with spec.
- **`initialInstructions` via first `prompt`, not CLI flag** → Spec §`start`; plan manual checklist uses it but no unit test step (Finding 2).
- **Engine isolation (no `src/workflow/` imports of pi modules)** → Task 5 Step 1 `rg` check only; no committed regression test like `runner-engine-isolation.test.ts` (Finding 6).
- **`AgentAdapter` contract unchanged; structural parity with `ScriptedAgentAdapter`** → Task 3 Step 8 explicitly mirrors scripted test patterns; `AgentAdapter` types already merged (#33). Plan does not add a structural assignability pin for `PiAgentAdapter` in `agent-adapter-types.test.ts` (nit).
- **Non-goals respected** → No workflow-engine edits, no SDK dependency, no streaming `send`, no SQLite writers. Aligned.

## Findings

1. **minor — Spawn CLI args underspecified in plan tests and implementation steps (Task 3, Step 4–5).** The spec requires `['--mode', 'rpc', '--offline', '--no-session']` (design §`start`). The plan’s spawn assertion only checks `['--mode','rpc']`, and Step 5 says “Implement `start()`” without listing the full argv. An implementer following only the plan could ship a non-headless or session-persisting spawn. Add the full arg list to Step 5 and assert it in the fake-transport capture test.

2. **minor — `initialInstructions` behavior has no unit-test step (Task 3).** The spec folds `initialInstructions` into the first RPC `prompt` after spawn, not a CLI flag. The optional manual checklist exercises this, but the TDD loop never asserts the transport receives a `prompt` with that text on `start()`. Add a failing test in Task 3 (e.g. after Step 4) before implementing prompt dispatch.

3. **minor — Transitional `starting` / `stopping` states from the shared `AgentAdapter` contract are not exercised (Task 3; design §`start` / #33 method contracts).** Issue #38 design explicitly sets `starting` during spawn; #33 defines `starting` and `stopping` as first-class states. The plan only asserts post-hoc `running` after `start()` and `stopped` after `stop()`, matching `ScriptedAgentAdapter`’s simplified transitions but not the written Pi contract. Either (a) add tests that observe `starting` during an async spawn and `stopping` during teardown, or (b) amend the design to state Pi skips visible transitional states (and accept divergence from #33’s contract text).

4. **minor — Process exit → `error` state is in the architecture but absent from the test plan (design §Layering; spec testing).** Design says `PiAgentAdapter` “maps process exit to `error` state.” Task 3’s fake transport should emit `close`/`exit` and assert `status().state === 'error'` and optionally `status().error`. Without this, a core failure mode is untested.

5. **minor — Log truncation not named in Task 3 test steps (Task 3, Steps 10–11; design §Testing).** The spec’s test list includes “log buffer growth + truncation flag.” Step 10 only says “`readLogs()` accumulates stdout.” Add an explicit failing test that fills the buffer past the cap and asserts `truncated: true`.

6. **minor — Engine isolation is a one-off `rg` in Task 5, not a durable regression test (Task 5, Step 1; compare `tests/unit/runner-engine-isolation.test.ts`).** The design constraint is as strong as the runner epic’s. A small test scanning `src/workflow/**/*.ts` for `/agents/pi` or `PiAgentAdapter` imports would prevent accidental coupling when the engine wires agents later. Recommend adding as Task 5 Step 1b (or fold into Task 3 Step 13).

7. **minor — `start-failed` when `workingDirectory` is missing/not a directory is not a named test (Task 3, Step 5).** Design requires reject with `start-failed` if cwd does not exist (`fs.access`). Plan mentions injectable `access` for tests but does not list a red step for the negative path.

8. **nit — Task 1 is create-then-build, not red-green (Task 1).** Pure type extraction is low risk and mirrors the runner plan pattern, but it breaks the plan’s stated TDD discipline for one task.

9. **nit — `buildPiCommandLine` is exported in Task 2 without a spec counterpart (Task 2, Step 3).** Fine as an internal helper; if exported, add a one-line note on its role (serialize RPC commands) or keep it module-private.

10. **nit — Transport factory naming drifts between spec and plan (`createTestPiRpcTransport` / `createInMemoryPiTransport` vs `transportFactory`).** Pick one vocabulary in the plan to match the design doc.

11. **nit — No commit-boundary or self-review acceptance table.** Prior plans (#18, #33) included per-task commit messages and a criterion→task matrix; this plan omits both. Not blocking, but reduces traceability for multi-agent execution.

## What looks good

- File layout matches the design verbatim (`log-snapshot.ts`, `pi-rpc.ts`, `pi.ts`, flat `tests/unit/pi-*.test.ts`) and respects the `src/agents/` vs `src/adapters/` split.
- Task 2 and Task 3 follow strict red/green cycles with concrete vitest commands and expected FAIL/PASS outcomes.
- Injectable transport is front-loaded (Task 2–3) with production `child_process.spawn` deferred to Task 4, keeping CI free of a live `pi` binary.
- `AgentLogSnapshot` field names align character-for-character with Runner `LogSnapshot` for ADR-0001 telemetry writers.
- Task 3 Step 8’s explicit pointer to `scripted-agent-adapter.test.ts` gives a complete behavioral checklist (invalid-state, reuse-after-stop, idempotent stop).
- Task 5 includes workflow `rg` guard and an optional manual smoke script; `execa` is correctly treated as optional in favor of `node:child_process`.
