# Implementation Review — Issue #26 Local Process Runner — Round 1

## Status
block

## Summary
`LocalProcessRunner`, shared `buildCombined`, barrel exports, and the planned test matrix are largely in place and align with the spec's architecture. Build succeeds and 273 of 274 tests pass. However, the full suite fails intermittently-but-reproducibly on `reuse after stop` due to a timing assertion, and the spawn path treats a non-zero child exit during `starting` as `spawn-failed`/`error` rather than a normal `stopped` transition — contradicting the spec's lifecycle section. Engine isolation is unchanged and `ScriptedRunner` behaviour is preserved via the `buildCombined` extraction.

## Test/Build Results
- `npm test`: **FAIL** — 35 test files, **273 passed / 274 total** (1 failure). Failure: `tests/unit/local-process-runner.test.ts` › `reuse after stop` › `allows spawn after stop` — expected `stopped`, received `running`. Reproduced on consecutive full-suite runs; the same test passes in isolation (`npx vitest run -t "allows spawn after stop"`).
- `npm run build`: **PASS** — `tsc -p tsconfig.json` exits 0; `ensure-bin-executable.mjs` succeeds.
- New test contribution: `log-format.test.ts` (4) + `local-process-runner.test.ts` (20) = 24 new tests. Prior baseline 250 + 24 = 274, matching expected count.

## Acceptance Criteria
| Criterion | Status | Evidence |
|-----------|--------|----------|
| Agents run as local processes without tmux | Met | `LocalProcessRunner` uses `execa` only (`src/runners/local.ts:265-297`); no tmux imports in `src/runners/`. |
| Log capture matches caller contract (same as scripted/tmux perspective) | Met | Shared `buildCombined` in `log-format.ts`; golden strings asserted in `log-format.test.ts` and per-stream integration tests in `local-process-runner.test.ts`; `ScriptedRunner` unchanged behaviour (16/16 green). |
| Process lifecycle (spawn, stop, crash detection) reliable | **Partial** | Happy-path spawn/stop, double-spawn guard, crash-while-running, stop-during-starting (fake), spawn-failed on missing binary, and reuse path are covered — but full-suite reuse test fails under load, and non-zero exit during `starting` violates spec (see Finding 2). |
| Workflow-engine isolation unchanged | Met | `tests/unit/runner-engine-isolation.test.ts` (3/3 pass); `grep` confirms no `src/workflow/` imports from `src/runners/`. |
| No workflow-engine or `start.ts` wiring | Met | Only `src/runners/` and `tests/unit/` touched; `src/commands/start.ts` execa handoff untouched. |

## Runner Contract Compliance
| Contract area | Status | Notes |
|---------------|--------|-------|
| `Runner` interface (`spawn`, `stop`, `logs`, `status`, `id`) | Met | `LocalProcessRunner` implements all methods (`src/runners/local.ts:63`). |
| State machine (`idle`/`starting`/`running`/`stopping`/`stopped`/`error`) | **Partial** | Most transitions match #18; non-zero exit during `starting` incorrectly enters `error` (Finding 2). |
| `RunnerError` codes | Met | `invalid-state`, `spawn-failed`, `stop-failed` exercised by tests. |
| `LogSnapshot` shape + `combined` format | Met | Field parity with `ScriptedRunner`; `buildCombined` golden tests pin format. |
| Idempotent `stop()` from `idle`/`stopped` | Met | Tests cover both paths. |
| Reuse after `stop()` | Met (logic) / **Fail (test)** | Implementation allows respawn from `stopped`; reuse integration test flakes in full suite (Finding 1). |
| `status()` fresh snapshots | Met | Mutation test passes. |
| `error → stopped` with preserved `status.error` | Met | `finalizeStop` preserves `priorError` (`local.ts:255-261`); test asserts. |
| Injectable `spawnProcess` for deterministic races | Met | Fakes cover stop-during-starting, exit-during-starting, crash-while-running, signal mapping, stop-failed. |
| Execa options per spec | Met | `stdio: ['ignore','pipe','pipe']`, `reject: false`, `cleanup: false`, `forceKillAfterDelay: false`, env merge (`local.ts:266-272`). |
| Defaults (`maxLogBytes` 1 MiB, `stopGraceMs` 5 s) | Met | `DEFAULT_MAX_LOG_BYTES` / `DEFAULT_STOP_GRACE_MS` (`local.ts:33-34`). |

## Findings

1. **major — Full suite fails on `reuse after stop` timing (tests/unit/local-process-runner.test.ts:282-299).** The second spawn runs `process.stdout.write('second')` (fast exit) but the test uses a fixed `50 ms` sleep without polling. Under parallel suite load the child is often still `running` when the assertion fires. Other tests in the same file poll up to 20 × 25 ms (e.g. lines 41-44, 77-80). Fix: reuse the polling loop pattern or await `child.exited` via status polling. Blocks the Task 9 full-suite gate.

2. **major — Non-zero exit during `starting` enters `error` instead of `stopped` (src/runners/local.ts:129-136; spec: Lifecycle "Unexpected exit").** When `earlyExit` resolves with a non-zero code while `state === 'starting'`, the runner sets `state = 'error'`, populates `errorMessage`, and throws `RunnerError('spawn-failed', ...)`. The spec states: "Do **not** enter `error` for non-zero exit codes — those are normal process outcomes" for unexpected exit while `running` **or** `starting`. The existing fake test (`transitions to stopped when child exits during starting`) only covers `exitCode: 0`. A child that exits with code 1 before reaching `running` should land in `stopped` with `exitCode: 1`, matching crash-while-running behaviour.

3. **minor — Dead `truncated` field (src/runners/local.ts:77, 108, 207).** `truncated` is reset on spawn but never set `true`; only `logTruncated` is updated in `wireStream`. `logs()` returns `this.truncated || this.logTruncated`. Behaviour is correct; the extra field is confusing dead state.

4. **minor — FIFO cap trims by code unit, measures by byte (src/runners/local.ts:46-60, 230-235).** `totalLogBytes` uses `Buffer.byteLength` but `trimLogsToCap` drops one UTF-16 code unit per iteration via `slice(1)`. Multi-byte UTF-8 output could remain above the byte cap longer than intended. Low risk for ASCII agent logs; worth aligning trim with byte budget if non-ASCII output is expected.

5. **minor — No injectable-fake test for stop escalation SIGTERM → grace → SIGKILL (spec: Testing line 134; plan review round 2 finding).** `'terminates a sleeping child'` exercises real-process stop end-to-end but cannot deterministically prove SIGKILL fires after grace expiry. Plan review round 2 demoted this to minor; still absent. Real-process coverage partially compensates.

6. **nit — Reuse test omits second-cycle `startedAt` freshness (plan review round 2 nit).** Test verifies second output and final `stopped` but not that `startedAt` advances on the second spawn — a cheap assertion that would mirror `scripted-runner.test.ts` reuse coverage.

## What Looks Good

- **File layout matches spec exactly.** `log-format.ts`, `local.ts`, `scripted.ts` refactor, `index.ts` exports, and both new test files are present with the planned responsibilities.
- **`buildCombined` extraction is safe.** Character-identical helper; `scripted-runner.test.ts` (16/16) confirms no observable regression.
- **Injectable `SpawnProcess` design is well exercised.** Five deterministic fake-spawn cases cover race-sensitive paths without OS timing dependence.
- **Barrel surface is complete.** `index.ts` exports `LocalProcessRunner`, `LocalProcessRunnerOptions`, `LocalProcessRunnerDeps`, `SpawnProcess`, and `SpawnProcessResult`; barrel smoke test passes.
- **Log truncation works on real processes.** Combined-byte budget test with `maxLogBytes: 50` passes and sets `truncated: true`.
- **Engine isolation holds.** `runner-engine-isolation.test.ts` unchanged and green; no `tmux` or `runners` imports under `src/workflow/`.
- **Scope boundaries respected.** No workflow-engine wiring, no `start.ts` changes, no new dependencies.
- **Stop semantics mirror ScriptedRunner for error preservation.** `priorError` captured before `stopping` and restored in `finalizeStop`, matching #18's `error → stopped` contract.

## Notes for Next Round

- Re-run `npm test` after fixing Finding 1; expect 274/274 green.
- Add a fake-spawn test for non-zero exit during `starting` expecting `stopped` + `exitCode` (not `spawn-failed`) when addressing Finding 2.
- Consider consolidating exit handling so `watchExit` and the `earlyExit` race in `spawn()` cannot diverge on the same child exit event.
- Optional polish: remove dead `truncated` field or use a single flag; add stop-escalation fake test if deterministic SIGKILL proof is desired before #25 tmux runner work.

STATUS=block
