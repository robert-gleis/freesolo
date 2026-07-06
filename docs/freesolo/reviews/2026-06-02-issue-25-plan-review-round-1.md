# Plan Review — Issue #25 (Round 1)

## Verdict
pass_with_findings

## Findings

1. **Task 8 isolation test conflicts with barrel export.** Task 8 Step 1 says every `.ts` under `src/` containing `tmux` must live under the `src/runners/tmux` path prefix. Task 8 Step 2 adds `export { TmuxRunner } from './tmux.js'` to `src/runners/index.ts`, which necessarily contains the substring `tmux`. That file fails the Step 1 rule as written. The spec (line 119) allows `tmux` in `src/runners/tmux*.ts` and `tests/**` but also requires export from `index.ts` (line 45). Fix: define the isolation matcher explicitly — e.g. allow `src/runners/index.ts` as an additional path, or match only tmux *runtime* usage (`execa('tmux'`, `'tmux'`, `runTmux`) rather than any case-insensitive substring — and document the chosen rule in Task 8 Step 1 before implementation.

2. **`stop-failed` error path has no task or test.** Spec errors table (lines 104–105) requires `stop()` to reject with `RunnerError('stop-failed', …)` and transition to `error` when `kill-session` fails unexpectedly. No plan task covers this. Add a test in Task 5 or a small Task 5b: mock `runTmux` so `kill-session` returns non-zero on stop from `running`, assert rejection code `stop-failed` and `status().state === 'error'`.

3. **Spawn poll timeout (`spawn-failed`) is unspecified in tests.** Spec spawn step 8 (lines 70–71) requires a ≤2s poll (50ms steps); on timeout → kill session, `error` state, reject `spawn-failed`. Task 3 Step 3 mentions polling but no task writes a failing test for timeout (e.g. mock never reports a live pane). Add to Task 4 alongside other `spawn-failed` cases.

4. **`new-session` failure is untested.** Spec groups "tmux missing / `new-session` fails" under `spawn-failed` (line 103). Task 4 tests `tmux -V` non-zero only. Add a case where `-V` succeeds but `new-session` returns non-zero.

5. **Session-name sanitization tests are incomplete vs spec.** Spec (line 58) requires trim leading/trailing hyphens and truncate to 200 chars. Task 1 tests prefix, invalid-char replacement, and hyphen collapse only; `sanitizeSessionName` is listed in the file table but has no direct edge-case tests. Extend Task 1 tests: e.g. `'--foo--'` → `'foo'`, and a 201+ char id truncates the sanitized segment to 200 chars (after `freesolo-` prefix logic is applied per spec).

6. **`now()` injectable dep is missing from the plan.** Spec architecture (line 51) lists `now: () => Date` in `TmuxRunnerDeps` for deterministic `startedAt` / `stoppedAt` in tests (mirrors `verification-runner.test.ts`). The plan never tasks wiring `now()` or asserting timestamps via a monotonic mock. Add to Task 2 skeleton (deps type + default) and at least one test in Task 3 or 5 that pins `startedAt`/`stoppedAt` through injected `now`.

7. **Stale-session cleanup lacks an explicit test.** Spec testing (line 117) and spawn step 4 (line 59) require `has-session` → `kill-session` before `new-session`. Task 3 implement step mentions it but Step 1 only asserts `new-session` + `send-keys`. Add a mock sequence test: pre-existing session → spawn issues `has-session` then `kill-session` before `new-session`.

8. **Log-cache-on-dead-session behavior is untested.** Spec logs (lines 90–91): when session is gone and runner never captured logs, return last cached capture from in-memory buffer updated on each `logs()` while running. Task 5 covers `capture-pane` but not the post-teardown cache path. Add: after `stop()` or simulated session loss, `logs()` returns the last cached stdout (not empty) when a prior `logs()` ran while `running`.

9. **`defaultTmuxRunnerDeps` / default `runTmux` implementation is untasked.** File-structure table lists `runTmux`, `TmuxExecResult`, and `defaultTmuxRunnerDeps` in `tmux-command.ts`, but only sanitization helpers are tasked in Task 1; later tasks inject mocks exclusively. Add an explicit step (Task 3 or 2) to implement the default `execa('tmux', args, { reject: false })` wrapper and wire `TmuxRunner` constructor to merge `defaultTmuxRunnerDeps` with overrides — otherwise production construction is undefined.

10. **Minor gaps (acceptable if addressed inline, not blockers).**
    - No test that `logs().stderr === ''` and `truncated === false` after spawn (spec lines 86–88).
    - No test that empty `env` entries are skipped for `set-environment` (spec line 68).
    - No `TmuxRunner` structural assignability check in `runner-types.test.ts` (pattern from #18).
    - Optional integration test (`tests/integration/tmux-runner.test.ts`, spec line 120) correctly omitted from plan scope.

## Coverage checklist

| Spec section | Plan task(s) | Notes |
|---|---|---|
| **Goals: `TmuxRunner` implements `Runner`** | Tasks 2–7 | Skeleton → full lifecycle |
| **Goals: encapsulate in `tmux.ts` + `tmux-command.ts`** | Tasks 1, 3, 5 | argv builders implicit in Task 3 |
| **Goals: `src/workflow/` free of `tmux`** | Task 8 + plan constraint | Existing `runner-engine-isolation.test.ts` unchanged |
| **Goals: DI unit tests, no real tmux in CI** | Tasks 2–7 | Mocked `runTmux` throughout |
| **Goals: export from `index.ts`** | Task 8 | See finding #1 for isolation conflict |
| **Non-goals: CLI/engine wiring, LocalProcessRunner, streaming, foreign sessions, interface change** | Plan header, file table | Correctly excluded |
| **Architecture: two-file split + `TmuxRunnerDeps`** | Tasks 1–3 | `now()` dep missing (finding #6); default deps untasked (#9) |
| **Isolation: `tmux` only in `tmux*.ts` (+ tests)** | Task 8 | Matcher must allow `index.ts` or narrow definition (#1) |
| **Session naming: `freesolo-<id>`, sanitization rules** | Task 1, Task 3 | Trim/truncate tests missing (#5) |
| **Session naming: stale `has-session` → `kill-session`** | Task 3 implement | Explicit test missing (#7) |
| **Spawn: precondition `idle`/`stopped` → `invalid-state`** | Task 4 | Covered |
| **Spawn: `starting`, `startedAt`** | Task 3 | `now()` dep untasked (#6) |
| **Spawn: `tmux -V` check → `spawn-failed`** | Task 3–4 | Covered |
| **Spawn: `new-session`, `set-environment`, `send-keys`** | Task 3 | Empty-env skip untested (#10) |
| **Spawn: poll until live / timeout → `spawn-failed`** | Task 3 implement | Timeout test missing (#3) |
| **Spawn: `new-session` fail → `spawn-failed`** | — | Test missing (#4) |
| **Spawn: not idempotent** | Task 4 | Covered |
| **Stop: `idle`/`stopped` no-op** | Task 6 | Covered |
| **Stop: `running`/`starting`/`error` → `stopping` → `stopped`** | Tasks 5–6 | Covered |
| **Stop: `pane_exit_status` best-effort** | Task 5 implement | No explicit test |
| **Stop: `kill-session`, ignore missing session** | Task 5 | Covered implicitly |
| **Stop: preserve `error` from `error` state** | Task 6 | Covered |
| **Stop: `kill-session` fail → `stop-failed`** | — | Missing (#2) |
| **Logs: `capture-pane`, stdout-only, `combined` format** | Task 5 | Match `ScriptedRunner` `buildCombined`; stderr-empty untested (#10) |
| **Logs: `sinceByteOffset`** | Task 7 | Covered |
| **Logs: `truncated: false`** | Task 5 | Implicit; no assertion (#10) |
| **Logs: empty before spawn** | Task 2 | Covered |
| **Logs: in-memory cache after session gone** | — | Test missing (#8) |
| **Status: fresh snapshot** | Tasks 2–7 | Immutability not explicitly tested (minor) |
| **Status: crash detection (`has-session` / `pane_dead`)** | Task 7 | Covered |
| **Errors: `logs` resolves empty when no cache (not `logs-unavailable`)** | — | Partially overlaps #8 |
| **#18 `spawn` contract** | Tasks 3–4, 6 | Reuse spawn→stop→spawn in Task 6 |
| **#18 `stop` contract** | Tasks 5–6 | `stop-failed` gap (#2) |
| **#18 `logs` contract** | Tasks 2, 5, 7 | |
| **#18 `status` contract** | Tasks 2, 7 | |
| **Testing: `tmux-runner.test.ts` lifecycle list** | Tasks 2–7 | Stale-session, stop-failed, poll-timeout gaps |
| **Testing: `tmux-command.test.ts`** | Task 1 | Incomplete sanitization (#5) |
| **Testing: `tmux-isolation.test.ts`** | Task 8 | Matcher needs fix (#1) |
| **Testing: optional integration** | — | Correctly deferred |
| **Verification: `npm test` + `npm run build`** | Plan Verification | Present |
