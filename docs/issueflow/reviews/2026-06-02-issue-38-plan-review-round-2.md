# Plan Review — Issue #38, Round 2

## Status
pass_with_findings

## Verification commands run
- `rg 'from.*pi|/agents/pi' src/workflow` — 0 matches (engine isolation premise holds today)
- `ls src/agents/ tests/unit/pi*.test.ts` — planned `pi*.ts` / `pi*.test.ts` files not present yet (expected pre-implementation)
- `npx tsc -p tsconfig.json` — PASS (baseline compiles)
- `npx vitest run` — PASS (114 tests, 0 failures; baseline suite green)

## Round 1 follow-up

| # | Round 1 finding | Status |
|---|-----------------|--------|
| 1 | Spawn argv underspecified (`--offline`, `--no-session`) | **Addressed.** Task 3 Step 4 asserts full argv; Steps 8 and Task 4 Step 1 repeat `['--mode', 'rpc', '--offline', '--no-session']`. |
| 2 | `initialInstructions` has no unit-test step | **Addressed.** Task 3 Step 5 asserts first RPC `prompt` on `start()`, not a CLI flag. |
| 3 | Transitional `starting` / `stopping` not exercised | **Addressed.** Task 3 Steps 7 and 13 add mid-flight assertions for both states. |
| 4 | Process exit → `error` absent from test plan | **Addressed.** Task 3 Step 14 adds `close`/`exit` while `running` → `error`. |
| 5 | Log truncation not named in test steps | **Addressed.** Task 3 Step 17 adds cap-exceeded → `truncated: true`. |
| 6 | Engine isolation is one-off `rg` only | **Addressed.** Task 5 Step 1b adds `pi-engine-isolation.test.ts` modeled on runner isolation. |
| 7 | `start-failed` when cwd missing not a named test | **Addressed.** Task 3 Step 6 injects failing `access`, asserts `start-failed` throw and `error` state. |
| 8 | Task 1 is create-then-build, not red-green | **Addressed.** Task 1 note documents the TDD exception explicitly. |
| 9 | `buildPiCommandLine` exported without spec counterpart | **Addressed.** Task 2 Step 3 keeps it module-private. |
| 10 | Transport factory naming drifts from spec | **Addressed.** Plan **Naming** block standardizes on `createInMemoryPiTransport` + `transportFactory`. |
| 11 | No commit-boundary or acceptance table | **Addressed.** Acceptance Criteria Mapping table, per-task commits, and Self-Review section added. |

All eleven round-1 findings are resolved in the updated plan.

## Acceptance criteria / spec alignment
- **Pi agents can be spawned via the adapter** → Task 3 + Task 4 with full argv and injectable/default transport. Aligned.
- **Adapter tracks agent status (idle / running / finished / errored)** → Task 3 lifecycle tests cover `idle`, `starting`, `running`, `stopping`, `stopped`, `error`, `start-failed`, and process-exit paths. Aligned with design status mapping.
- **Adapter captures logs consumable by the event log** → Task 1 types + Task 3 Steps 16–18 (`readLogs`, ring buffer, truncation). Aligned.
- **Injectable transport / no live Pi in CI** → Tasks 2–4. Aligned.
- **JSONL framing, extension UI auto-cancel, engine isolation** → Tasks 2 and 5. Aligned.
- **`initialInstructions` via first `prompt`** → Task 3 Step 5. Aligned.
- **Non-goals respected** → No workflow-engine edits, no SDK dependency, no streaming `send`, no SQLite writers. Aligned.

## Findings

1. **minor — `send-failed` on RPC/transport failure has no Pi-specific test step (Task 3, Step 12; design §`send`).** Design requires: on RPC/transport failure, set `error` and throw `send-failed`. Step 12 says “mirror `scripted-agent-adapter.test.ts` patterns,” but scripted’s `send-failed` case is “no script step matched,” which does not exist on Pi. Add an explicit red step (e.g. script transport returns `success: false` or rejects mid-`prompt`) asserting `send-failed` and `status().state === 'error'`.

2. **minor — Production transport `kill` semantics not specified (Task 4, Step 1; design §`stop`).** Design calls for best-effort `abort` RPC, then SIGTERM with SIGKILL after a short timeout. Task 3 exercises async `kill` via the fake transport; Task 4 only documents `spawn` piping. Add one line to Task 4 Step 1 (or a new Step 1b) that `createNodePiTransport`’s `kill` uses SIGTERM → timed SIGKILL, matching design §`stop`, even if unit tests stay on the fake factory.

3. **nit — Optional `env` overrides from design §`start` are absent from plan steps.** Design allows `env` on adapter options merged into spawn. Not in issue acceptance criteria or design Testing section; acceptable to defer, but the Self-Review table claims “All spec requirements are covered” without noting this omission.

4. **nit — `readLogs()` Step 16 only names stdout accumulation (Task 3, Step 16).** `AgentLogSnapshot` includes `stderr` and `combined`; Task 4 pipes stderr. A one-line note in Step 16 or 18 that the ring buffer covers both streams (and `combined`) would match the spec field list without needing a separate test.

5. **nit — `startedAt` / `lastActivityAt` not pinned explicitly, though Step 12’s scripted mirror likely covers them.** Scripted tests assert `startedAt` on `start` and `lastActivityAt` on `send`. Calling out those two assertions in Step 12’s bullet list would remove ambiguity for multi-agent execution.

6. **nit — Design doc Layering still says `createTestPiRpcTransport`; plan chose `createInMemoryPiTransport`.** Plan Naming block resolves implementer vocabulary; optional Task 5 doc touch could sync the design doc.

7. **nit — No structural assignability pin for `PiAgentAdapter` in `agent-adapter-types.test.ts` (carried from round 1).** Low risk given `implements AgentAdapter` in source; optional one-liner in Task 3 Step 19.

## What looks good

- Every round-1 minor finding has a concrete, traceable fix in the plan — no partial or hand-wavy resolutions.
- Acceptance Criteria Mapping and Self-Review tables give multi-agent workers a checklist without re-reading the design.
- Task ordering preserves injectable-transport-first, production-spawn-deferred (Task 4), keeping CI free of a live `pi` binary.
- File layout, type names, and `AgentLogSnapshot` fields match the design and Runner `LogSnapshot` shape character-for-character.
- Task 3’s expanded lifecycle coverage (transitional states, process exit, truncation, `start-failed`) exceeds what the design Testing section enumerates and closes the main behavioral gaps from round 1.
- Task 5 engine-isolation test follows the established `runner-engine-isolation.test.ts` pattern with a sanity-check assertion.
- Commit boundaries remain sensible and scoped per task.
