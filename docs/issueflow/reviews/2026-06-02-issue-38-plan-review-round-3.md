# Plan Review — Issue #38, Round 3

## Status
pass

## Finding count
0

## Verification commands run
- `rg 'from.*pi|/agents/pi' src/workflow` — 0 matches (engine isolation premise holds today)
- `ls src/agents/ tests/unit/pi*.test.ts` — planned `pi*.ts` / `pi*.test.ts` files not present yet (expected pre-implementation)
- `npx tsc -p tsconfig.json` — PASS (baseline compiles)
- `npx vitest run` — PASS (114 tests, 0 failures; baseline suite green)

## Round 2 follow-up

| # | Round 2 finding | Status |
|---|-----------------|--------|
| 1 | `send-failed` on RPC/transport failure has no Pi-specific test step | **Addressed.** Task 3 Step 12 adds explicit Pi-specific red step: transport returns `success: false` or rejects mid-`prompt` → `send-failed` + `error` state. |
| 2 | Production transport `kill` semantics not specified (SIGTERM → SIGKILL) | **Addressed.** Task 4 Step 1 documents SIGTERM with timed SIGKILL, matching design §`stop`. |
| 3 | Optional `env` overrides absent; Self-Review overclaims coverage | **Accepted deferral.** Not in issue acceptance criteria or design Testing section; no plan change required for this ticket. |
| 4 | `readLogs()` Step 16 only named stdout | **Addressed.** Task 3 Step 16 asserts both streams, `combined` line-prefixed interleaving (Runner `LogSnapshot` shape). |
| 5 | `startedAt` / `lastActivityAt` not pinned in Step 12 | **Addressed.** Task 3 Step 12 explicitly asserts both timestamps. |
| 6 | Design doc Layering still says `createTestPiRpcTransport` | **Accepted deferral.** Plan Naming block is authoritative for implementers; optional design-doc sync is out of scope for plan approval. |
| 7 | No structural assignability pin in `agent-adapter-types.test.ts` | **Accepted deferral.** Low risk with `implements AgentAdapter` in source; optional hardening, not a plan blocker. |

All seven round-2 findings are either resolved in the plan or explicitly deferrable without blocking implementation.

## Acceptance criteria / spec alignment
- **Pi agents can be spawned via the adapter** → Task 3 + Task 4 with full argv `['--mode', 'rpc', '--offline', '--no-session']`, injectable and default transport. Aligned.
- **Adapter tracks agent status (idle / running / finished / errored)** → Task 3 lifecycle tests cover `idle`, `starting`, `running`, `stopping`, `stopped`, `error`, `start-failed`, process-exit, and transitional states. Aligned with design status mapping.
- **Adapter captures logs consumable by the event log** → Task 1 types + Task 3 Steps 16–18 (`readLogs`, stdout/stderr/combined ring buffer, truncation). Aligned.
- **Injectable transport / no live Pi in CI** → Tasks 2–4. Aligned.
- **JSONL framing, extension UI auto-cancel, engine isolation** → Tasks 2 and 5 (including `pi-engine-isolation.test.ts`). Aligned.
- **`initialInstructions` via first `prompt`** → Task 3 Step 5. Aligned.
- **Non-goals respected** → No workflow-engine edits, no SDK dependency, no streaming `send`, no SQLite writers. Aligned.

## Findings
None. No open items require plan changes before implementation.

## Observations (non-blocking)
- Acceptance Criteria Mapping table (line 21) references Task 3 Steps 14–15 for `readLogs()`; the actual read-log steps are 16–18. Harmless cross-reference typo; Task 3 body is correct.
- Design §`stop` also calls for best-effort `abort` RPC before SIGTERM; Task 3 Step 15 and Task 4 Step 1 cover teardown at a high level and `PiRpcSession.abort()` exists in Task 2. Implementers will follow the design doc for ordering; no additional plan step needed.
- Self-Review “All spec requirements are covered” excludes deferred `env` overrides (round-2 item 3); acceptable given non-goals and testing scope.

## What looks good
- Round-2 actionable minors (`send-failed`, kill semantics, stderr/combined logs, timestamps) have concrete, traceable fixes — not hand-wavy.
- Acceptance Criteria Mapping, Self-Review table, and per-task commits give multi-agent workers a checklist without re-reading the design.
- Task ordering preserves injectable-transport-first, production-spawn-deferred (Task 4), keeping CI free of a live `pi` binary.
- File layout, type names, and `AgentLogSnapshot` fields match the design and Runner `LogSnapshot` shape character-for-character.
- Task 3 lifecycle coverage (transitional states, process exit, truncation, `start-failed`, Pi-specific `send-failed`) meets or exceeds the design Testing section.
- Task 5 engine-isolation test follows the established `runner-engine-isolation.test.ts` pattern with a sanity-check assertion.
- `buildPiCommandLine` remains module-private; transport naming is standardized on `createInMemoryPiTransport` + `transportFactory`.
