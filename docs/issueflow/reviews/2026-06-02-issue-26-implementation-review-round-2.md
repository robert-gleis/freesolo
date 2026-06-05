# Implementation Review — Issue #26 Local Process Runner — Round 2

## Status
pass

## Summary
All three round 1 blockers are resolved. The reuse-after-stop test polls for terminal state instead of a fixed sleep; non-zero child exit during `starting` transitions to `stopped` with `exitCode` (not `error`/`spawn-failed`); the dead `truncated` instance field is removed in favour of `logTruncated` only. Full suite and build are green at 275 tests. Implementation matches the spec, plan, and #18 runner contract. Remaining items are optional polish carried from round 1 (UTF-8 trim semantics, deterministic SIGKILL proof, reuse `startedAt` assertion).

## Test/Build Results
- `npm test`: **PASS** — 35 test files, **275 passed / 275 total**.
- `npm run build`: **PASS** — `tsc -p tsconfig.json` exits 0; `ensure-bin-executable.mjs` succeeds.
- New test contribution vs baseline: `log-format.test.ts` (4) + `local-process-runner.test.ts` (21) = 25 new tests. Prior baseline 250 + 25 = 275.

## Round 1 Blocker Verification

| Round 1 finding | Resolution | Evidence |
|-----------------|------------|----------|
| **major** — reuse test flake (fixed sleep) | **Fixed** | `reuse after stop` polls up to 20 × 25 ms for `stopped` (`local-process-runner.test.ts:313-316`); full suite green under load. |
| **major** — non-zero exit during `starting` → `error` | **Fixed** | `spawn()` early-exit path sets `stopped` + `exitCode` without throwing (`local.ts:127-132`); new fake test `records non-zero exit during starting as stopped, not error` (`local-process-runner.test.ts:229-244`). |
| **minor** — dead `truncated` field | **Fixed** | Single `logTruncated` flag; `logs()` returns `truncated: this.logTruncated` (`local.ts:77, 199`). |

## Acceptance Criteria
| Criterion | Status | Evidence |
|-----------|--------|----------|
| Agents run as local processes without tmux | Met | `LocalProcessRunner` uses `execa` only (`local.ts:257-288`); no tmux imports in `src/runners/`. |
| Log capture matches caller contract | Met | Shared `buildCombined` in `log-format.ts`; golden tests in `log-format.test.ts`; per-stream integration tests in `local-process-runner.test.ts`; `scripted-runner.test.ts` (16/16) unchanged. |
| Process lifecycle reliable | Met | Happy-path spawn/stop, double-spawn guard, crash-while-running, stop-during-starting, non-zero exit during starting, spawn-failed on missing binary, reuse, and signal mapping covered. |
| Workflow-engine isolation unchanged | Met | `runner-engine-isolation.test.ts` (3/3); no `src/workflow/` imports from `src/runners/`. |
| No workflow-engine or `start.ts` wiring | Met | Only `src/runners/` and `tests/unit/` touched. |

## Runner Contract Compliance
| Contract area | Status | Notes |
|---------------|--------|-------|
| `Runner` interface | Met | All methods implemented (`local.ts:63`). |
| State machine | Met | Non-zero exit during `starting`/`running` → `stopped`; spawn/stop failures → `error`. |
| `RunnerError` codes | Met | `invalid-state`, `spawn-failed`, `stop-failed` exercised. |
| `LogSnapshot` + `combined` format | Met | Field parity with `ScriptedRunner`; golden tests pin format. |
| Idempotent `stop()` | Met | Idle/stopped no-op tests pass. |
| Reuse after `stop()` | Met | Integration test passes in full suite with polling. |
| `status()` fresh snapshots | Met | Mutation test passes. |
| `error → stopped` with preserved `status.error` | Met | `priorError` in `finalizeStop` (`local.ts:247-253`). |
| Injectable `spawnProcess` | Met | Six deterministic fake-spawn cases including non-zero exit during starting. |
| Execa options per spec | Met | `stdio`, `reject`, `cleanup`, `forceKillAfterDelay`, env merge (`local.ts:258-264`). |
| Defaults | Met | `DEFAULT_MAX_LOG_BYTES` / `DEFAULT_STOP_GRACE_MS` (`local.ts:33-34`). |

## Findings

1. **minor — FIFO cap trims by code unit, measures by byte (`local.ts:46-60, 222-227`).** `totalLogBytes` uses `Buffer.byteLength` but `trimLogsToCap` drops one UTF-16 code unit per iteration via `slice(1)`. Multi-byte UTF-8 output could remain above the byte cap briefly. Low risk for ASCII agent logs; align trim with byte budget if non-ASCII output is expected. Carried from round 1.

2. **minor — No injectable-fake test for stop escalation SIGTERM → grace → SIGKILL (spec Testing line 134).** `'terminates a sleeping child'` exercises real-process stop end-to-end but cannot deterministically prove SIGKILL fires after grace expiry. Real-process coverage partially compensates. Carried from round 1.

3. **nit — Reuse test omits second-cycle `startedAt` freshness (`local-process-runner.test.ts:299-319`).** Test verifies second output and final `stopped` but not that `startedAt` advances on the second spawn. Cheap assertion mirroring `scripted-runner.test.ts` reuse coverage. Carried from round 1.

## What Looks Good

- **Round 1 majors fully addressed** with targeted code and test changes, not workarounds.
- **File layout matches spec.** `log-format.ts`, `local.ts`, `scripted.ts` refactor, `index.ts` exports, both test files present.
- **`buildCombined` extraction is safe.** `scripted-runner.test.ts` (16/16) confirms no regression.
- **Injectable spawn design well exercised.** Fake-spawn cases cover race-sensitive paths without OS timing dependence.
- **Barrel surface complete.** Exports `LocalProcessRunner`, options, deps, `SpawnProcess`, `SpawnProcessResult`; smoke test passes.
- **Engine isolation holds.** No workflow imports; scope boundaries respected.
- **Stop semantics mirror ScriptedRunner** for error preservation via `priorError`.

## Notes for Merge

- Ready to merge from an implementation-review perspective.
- Optional follow-ups (non-blocking): byte-aligned log trim, deterministic SIGKILL fake test, reuse `startedAt` assertion.

STATUS=pass
