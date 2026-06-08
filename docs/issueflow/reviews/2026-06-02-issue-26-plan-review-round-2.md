# Plan Review — Issue #26, Round 2

## Status
pass

## Summary
The updated plan closes every round-1 major gap and nearly all minor parity items. Task 4 now pins `stop()` during `starting` via an injectable fake with a `runningGate`; Task 6 adds exit-during-`starting`, signal-to-`exitCode` mapping, and `stop-failed`; Task 8 is a full TDD task with reuse, snapshot-freshness, and barrel-export tests. Spec architecture, identifier fidelity, execa options, dual-stream truncation, and #18 lifecycle parity (`stopped` no-op, `error → stopped` with preserved `status.error`, `startedAt` while `running`) are all traceable to concrete test snippets. One spec-named injectable-fake case (`stop` escalation) remains untested; real-process `stop()` coverage and implementation notes partially compensate, so the gap is minor rather than blocking.

## Round 1 follow-up

1. **stop during `starting` (major)** — addressed. Task 4 adds `'stops a child still in starting'` with a `SpawnProcess` fake that holds `exited` on `runningGate` until after `stop()` completes; asserts `starting` before stop and `stopped` after (plan lines 317–335).

2. **exit during `starting` + stop escalation (major)** — partially addressed. Exit-during-`starting` is covered in Task 6 (`'transitions to stopped when child exits during starting'`, plan lines 428–440). Stop escalation (SIGTERM grace → SIGKILL) has implementation guidance in Task 4 Step 2–4 and is exercised indirectly by the real-process `'terminates a sleeping child'` test, but the spec's injectable-fake requirement for escalation (spec Testing line 134) still has no dedicated fake-spawn test. Demoted to minor in New findings below.

3. **Task 8 reuse placeholder (major)** — addressed. Task 8 now includes a full reuse test (`spawn → stop → spawn`, asserts second output), snapshot-freshness test, barrel re-export steps, and a barrel smoke test (plan lines 504–554).

4. **`idle → spawn → running` with `startedAt` (minor)** — addressed. Task 3 adds `'observes running with startedAt before child exits'` using a long-running `setInterval` child (plan lines 217–229).

5. **`status()` fresh snapshots (minor)** — addressed. Task 8 `'returns a fresh object on each call'` mutates a returned snapshot and re-reads (plan lines 527–534).

6. **Full golden `combined` on integration (minor)** — addressed for per-stream cases. Task 3 uses `.toBe('[stdout]\nhi\n')` and `.toBe('[stderr]\nerr\n')`; Task 1 pins the dual-stream golden in isolation. No single real-process script writes both streams with the full `'[stdout]\nhello\n\n[stderr]\noops\n'` string — acceptable given Task 1 coverage.

7. **`stop()` no-op from `stopped` (minor)** — addressed. Task 4 `'is a no-op from stopped'` (plan lines 304–315).

8. **`error → stopped` with preserved `status.error` (minor)** — addressed. Task 5 `'preserves error message after stop from error state'` (plan lines 372–381).

9. **`stop-failed` path (minor)** — addressed. Task 6 fake with `kill` that throws (plan lines 456–469).

10. **execa options completeness (minor)** — addressed. Task 3 Step 3 lists `cleanup: false`, `forceKillAfterDelay: false`, and `env: { ...process.env, ...spec.env }` (plan line 254).

11. **Signal exit-code mapping (minor)** — addressed. Task 6 `'maps signal exit to exitCode 128'` (plan lines 442–454).

12. **Truncation across both streams (minor)** — addressed. Task 7 writes both stdout and stderr with `maxLogBytes: 50` and asserts combined byte budget (plan lines 479–496).

13. **spawn-failed observability (nit)** — addressed. Task 5 asserts `status.error` and `status.startedAt` (plan lines 367–369).

14. **stderr capture on real process (nit)** — addressed. Task 3 `'captures stderr on a real process'` (plan lines 231–242).

15. **`SpawnProcess` barrel-export wording (nit)** — addressed. Task 8 reconciles: "exported intentionally for test fakes importing from the barrel" (plan line 544); Task 3's "not exported in public options" correctly scopes to constructor `deps`, not the type.

## New findings

1. **minor — Injectable-fake test for `stop` escalation (SIGTERM → grace → SIGKILL) still absent (spec: Testing line 134; plan: Task 4).** The spec names stop escalation alongside exit-during-`starting` as a race-sensitive case for `spawnProcess` fakes. Task 4's real-process `'terminates a sleeping child'` exercises `stop()` end-to-end but cannot deterministically prove SIGKILL fires after the grace window expires. A cheap fake: `kill` records signals sent, `exited` resolves only after the second signal (or after a timer past `stopGraceMs`). Optional before implementation; not blocking given the real-process stop test and explicit implementation step.

2. **nit — Reuse-after-stop test does not assert `startedAt` freshness (plan: Task 8, lines 507–524).** The test verifies second-spawn output and final `stopped` state but not that `startedAt` on the second run is a new `Date` (issue-18 Task 7 lesson). Cheap addition: capture `startedAt` after first spawn's `running` observation, assert second cycle's `startedAt` is defined and later. Pure polish.

## What looks good

- **File layout matches the spec exactly.** `log-format.ts`, `local.ts`, `scripted.ts` refactor, `index.ts` export, `tests/unit/log-format.test.ts`, `tests/unit/local-process-runner.test.ts` — unchanged and correct from round 1.
- **Round-1 TDD discipline gap closed.** Task 8 is no longer a placeholder bullet; every task (1–9) has concrete test snippets, implementation steps, and expected PASS/FAIL outcomes.
- **Injectable `SpawnProcess` design is exercised across races.** Fakes cover stop-during-`starting`, exit-during-`starting`, unexpected exit while `running`, signal mapping, and `stop-failed` — five deterministic cases without relying on OS timing.
- **Acceptance-criteria state-machine list is fully mapped.** Happy-path spawn/stop, stop during `starting`, unexpected exit while `running`, non-zero `exitCode`, double-spawn rejected — each has a named test in Tasks 3–6.
- **Log-format extraction remains safe.** Task 1's `buildCombined` is character-identical to the prior `scripted.ts` helper; Step 4 runs `scripted-runner.test.ts` as regression gate.
- **Identifier fidelity holds.** `LocalProcessRunnerOptions`, `RunnerError` codes, `LogSnapshot` fields, `SpawnSpec` usage, and `SpawnProcess` shape all match the spec and `types.ts`.
- **Scope boundaries respected.** No `src/workflow/` changes, no `start.ts` refactor, engine-isolation test untouched, Task 9 full-suite gate with `npm test` and `npm run build`.
- **Test conventions match the repo.** Vitest, flat `tests/unit/`, `../../src/runners/X.js` imports with `.js` extension — consistent with existing runner tests.

STATUS=pass
