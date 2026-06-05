# Plan Review — Issue #26, Round 1

## Status
pass_with_findings

## Summary
The plan correctly targets the spec's architecture (`log-format.ts` extraction, `LocalProcessRunner` in `local.ts`, barrel export, no workflow/CLI changes) and follows repo test conventions (vitest, flat `tests/unit/`, `.js` import paths). Task 1 is a clean red/green extraction with scripted-runner regression coverage. Identifier fidelity to `Runner` types is strong (`LocalProcessRunnerOptions`, `RunnerError` codes, `LogSnapshot` field names). The injectable `spawnProcess` design is sound for deterministic races. Main gaps: three spec-enumerated lifecycle cases are missing from the plan (`stop` during `starting`, exit during `starting`, `status()` snapshot freshness); Task 8's reuse test is an undeveloped bullet with no TDD steps; and several #18 parity tests (`stop` from `stopped`, `error → stopped` with preserved `error`, `stop-failed`, full golden `combined` on a real process) are absent.

## Findings

1. **major — Acceptance criteria require "stop during `starting`"; plan has no test or implementation step (spec: Acceptance Criteria Mapping line 127; plan: Tasks 4–6).** The spec's state-machine test list explicitly names this case alongside happy-path spawn/stop and unexpected exit. `ScriptedRunner` already exercises `starting → stopped` via `spawnDelayMs` in `scripted-runner.test.ts`. `LocalProcessRunner` needs either an injectable fake that delays the `running` transition or a long-running `node -e` script plus an early `stop()` call. Without it, a core acceptance criterion is untested.

2. **major — Spec testing section requires injectable-fake coverage for "exit during `starting`" and "stop escalation"; plan Task 6 only covers unexpected exit while `running` (spec: Testing lines 134–135; plan: Task 6).** The spec calls out both race-sensitive cases for the fake spawn dep. Task 6's fake resolves exit only after the runner reaches `running`. Exit-during-`starting` (child dies before the supervisor flips to `running`) and stop escalation (SIGTERM grace window → SIGKILL) have no planned tests or implementation notes.

3. **major — Task 8 reuse test is a placeholder bullet, not a TDD task (plan: Task 8, first bullet).** The line "Test reuse: spawn → stop → spawn again succeeds" has no failing-test snippet, no assertions (`startedAt` freshness, cleared `stoppedAt`/`exitCode`), and no red/green steps. This violates the plan's own checkbox discipline and the reviewer's no-TBD check. `ScriptedRunner`'s reuse test in `scripted-runner.test.ts` (lines 199–218) is a ready template.

4. **minor — Spec test list "idle → spawn → running with `startedAt`" is not covered (spec: Testing line 136; plan: Task 3).** Task 3's happy-path test spawns a script that exits immediately and asserts `stopped` after a 50 ms sleep. It never observes `running` or `startedAt`. A long-running child (the `setInterval` pattern already used in Task 4) with a mid-flight `status()` assertion would close the gap cheaply.

5. **minor — Spec test list "`status()` returns fresh snapshots" has no plan task (spec: Testing line 146; plan: entire file).** `scripted-runner.test.ts` pins this by mutating a returned snapshot and re-reading. The same one-liner pattern should appear in `local-process-runner.test.ts` to satisfy spec coverage and prevent shared-mutable-status bugs.

6. **minor — Integration test does not assert full scripted golden `combined` string (spec: Testing line 138; plan: Task 3).** Task 3 checks `logs.combined.toContain('[stdout]')` only. Task 1 pins `buildCombined` in isolation, but the spec also asks for integration-style confirmation that a real local runner's `combined` matches scripted golden strings (e.g. `'[stdout]\nhello\n\n[stderr]\noops\n'` from `scripted-runner.test.ts:52`). A single node script writing both streams with `.toBe(...)` would satisfy this.

7. **minor — `stop()` no-op from `stopped` is untested (spec: Lifecycle line 96; plan: Task 4).** Task 4 covers idle no-op. `ScriptedRunner` tests idempotent stop from `stopped` (`scripted-runner.test.ts:150–161`). Missing here.

8. **minor — `error → stopped` with preserved `status.error` is untested (spec: Lifecycle line 99; plan: Tasks 5–6).** Spec says prior `error` is preserved on final `stopped` snapshot, matching `ScriptedRunner`. Task 5's spawn-failed test asserts `state: 'error'` but does not call `stop()` and assert `status.error` survives. `ScriptedRunner` covers this at `scripted-runner.test.ts:163–176`.

9. **minor — `stop-failed` path has no test or implementation guidance (spec: Lifecycle line 98; #18 `stop()` contract).** Real runners can fail to signal a process. The plan implements SIGTERM/SIGKILL escalation but never documents what constitutes `stop-failed` or how to test it (e.g. fake `kill` that throws).

10. **minor — Spec execa options partially omitted from implementation steps (spec: Subprocess options lines 58–65; plan: Task 3 Step 3).** Plan mentions `reject: false` and stdio pipes but not `cleanup: false`, `forceKillAfterDelay: false`, or env merge `{ ...process.env, ...spec.env }`. These are behavioural requirements, not optional niceties.

11. **minor — Signal exit-code mapping undocumented (spec: Unexpected exit line 92; plan: Task 3).** Spec defines `exitCode = code ?? (signal ? 128 : 0)`. Plan's `SpawnProcess.exited` shape carries `signal` but no implementation step applies the mapping. A fake-spawn test with `{ exitCode: null, signal: 'SIGTERM' }` would pin it.

12. **minor — Truncation test exercises stdout only; spec caps across both streams combined (spec: Log capture line 74; plan: Task 7).** FIFO eviction order when stdout and stderr interleave is the hard part. Task 7's single-stream `stdout.write(big)` test won't catch a bug that truncates per-stream independently instead of across the combined byte budget.

13. **nit — Task 5 spawn-failed test omits `status.error` and `status.startedAt` assertions (plan: Task 5; compare `scripted-runner.test.ts:109–113`).** Cheap parity with the reference runner's spawn-failure observability.

14. **nit — No real-process stderr capture test (plan: Tasks 3–4).** All integration assertions target stdout. A one-liner `process.stderr.write(...)` would confirm stderr piping.

15. **nit — Task 8 exports `SpawnProcess` from the public barrel while Task 3 labels the dep "tests only; not exported in public options" (plan: Task 3 Step 3 vs Task 8).** Exporting the type is defensible for test imports, but the contradictory wording should be reconciled (either export intentionally or keep the type module-private).

## What looks good

- **File layout matches the spec exactly.** `log-format.ts`, `local.ts`, `scripted.ts` refactor, `index.ts` export, `tests/unit/log-format.test.ts`, `tests/unit/local-process-runner.test.ts` — all present with clear responsibilities.
- **Log-format extraction is safe.** Task 1's `buildCombined` implementation is character-identical to `scripted.ts:107–112`. Golden tests match `scripted-runner.test.ts` expectations (`'[stdout]\nhello\n\n[stderr]\noops\n'`, single-stream, empty). Step 4 runs `scripted-runner.test.ts` as a regression gate — correct safety net.
- **Identifier fidelity to Runner types is correct.** `LocalProcessRunnerOptions` fields (`maxLogBytes`, `stopGraceMs`), `RunnerError` codes (`invalid-state`, `spawn-failed`), `LogSnapshot` shape (`stdout`, `stderr`, `combined`, `truncated`), and `SpawnSpec` usage in tests all match `types.ts` and the #26 spec.
- **Test conventions match the repo.** Vitest, flat `tests/unit/` (verified: 31 existing `*.test.ts` files, no subdirectories), `../../src/runners/X.js` imports with `.js` extension — consistent with `scripted-runner.test.ts` and `runner-types.test.ts`.
- **TDD discipline is strong in Tasks 1–7.** Each has explicit failing-test commands, expected failure modes, and minimum implementations. No "implement later" handwaving in those tasks.
- **Injectable spawn design is well-shaped.** `SpawnProcess` abstracts streams, `kill`, and `exited` into a testable surface; third-argument `deps` keeps production constructor clean; real-process tests use `process.execPath` for CI portability as noted in Reviewer Notes.
- **Scope boundaries are respected.** No `src/workflow/` changes, no `start.ts` refactor, engine-isolation test left untouched — all per spec non-goals.
- **Task 9 gates with full `npm test` and `npm run build`.** Typecheck and existing suite regression surface before handoff.

STATUS=pass_with_findings
