# Plan Review — Issue #25 (Round 2)

## Verdict

pass

## Findings

No findings.

## Round 1 resolution

| Round 1 # | Topic | Status in updated plan |
|---|---|---|
| 1 | Isolation test vs `index.ts` barrel export | **Resolved** — Task 8 Step 1 narrows to tmux *runtime* usage (`execa('tmux'`, `runTmux(`) and allowlists `src/runners/index.ts` |
| 2 | `stop-failed` path untested | **Resolved** — Task 5 Step 1 item 4 |
| 3 | Spawn poll timeout untested | **Resolved** — Task 4 Step 1 item 4 |
| 4 | `new-session` failure untested | **Resolved** — Task 4 Step 1 item 3 |
| 5 | Sanitization trim/truncate tests missing | **Resolved** — Task 1 tests for `--foo--` and 201-char truncation |
| 6 | `now()` dep missing | **Resolved** — Task 2 deps + Task 3/5 timestamp tests |
| 7 | Stale-session cleanup test missing | **Resolved** — Task 3 Step 1 item 2 |
| 8 | Log cache after session gone untested | **Resolved** — Task 5 Step 1 item 5 |
| 9 | `defaultTmuxRunnerDeps` untasked | **Resolved** — Task 2 Step 1 |
| 10 | Minor gaps (stderr, truncated, empty env, barrel assignability) | **Resolved** — Task 3 item 4, Task 5 item 2, Task 8 Step 3 |

## Coverage checklist

| Spec section | Plan task(s) | Notes |
|---|---|---|
| **Goals: `TmuxRunner` implements `Runner`** | Tasks 2–7 | Skeleton → full lifecycle |
| **Goals: encapsulate in `tmux.ts` + `tmux-command.ts`** | Tasks 1–3, 5 | Sanitization + exec wrapper in `tmux-command.ts`; state machine in `tmux.ts` |
| **Goals: `src/workflow/` free of `tmux`** | Task 8 + plan constraint | Existing `runner-engine-isolation.test.ts` unchanged |
| **Goals: DI unit tests, no real tmux in CI** | Tasks 2–7 | Mocked `runTmux` throughout |
| **Goals: export from `index.ts`** | Task 8 | Allowlisted in isolation test |
| **Non-goals: CLI/engine wiring, LocalProcessRunner, streaming, foreign sessions, interface change** | Plan header, file table | Correctly excluded |
| **Architecture: two-file split + `TmuxRunnerDeps`** | Tasks 1–3 | `runTmux` + `now` wired in Task 2 |
| **Isolation: tmux runtime only in allowed paths** | Task 8 | Runtime matcher + allowlist (improvement over bare substring) |
| **Session naming: `issueflow-<id>`, sanitization rules** | Task 1, Task 3 | Trim, collapse, truncate covered in Task 1 |
| **Session naming: stale `has-session` → `kill-session`** | Task 3 | Explicit ordered mock test |
| **Spawn: precondition `idle`/`stopped` → `invalid-state`** | Task 4 | Covered |
| **Spawn: `starting`, `startedAt`** | Task 3 | `now()` injection test |
| **Spawn: `tmux -V` check → `spawn-failed`** | Task 4 | Covered |
| **Spawn: `new-session`, `set-environment`, `send-keys`** | Task 3 | Empty-env skip tested |
| **Spawn: poll until live / timeout → `spawn-failed`** | Task 3 implement, Task 4 test | Timeout case in Task 4 |
| **Spawn: `new-session` fail → `spawn-failed`** | Task 4 | Covered |
| **Spawn: not idempotent** | Task 4 | Covered |
| **Stop: `idle`/`stopped` no-op** | Task 6 | Covered |
| **Stop: `running`/`starting`/`error` → `stopping` → `stopped`** | Tasks 5–6 | `running` and `error` tested; `starting` implied by spec implement steps (acceptable) |
| **Stop: `pane_exit_status` best-effort** | Task 5 implement | No dedicated test (minor; same as round 1 acceptable inline) |
| **Stop: `kill-session`, ignore missing session** | Task 5 | Covered implicitly |
| **Stop: preserve `error` from `error` state** | Task 6 | Covered |
| **Stop: `kill-session` fail → `stop-failed`** | Task 5 | Covered |
| **Logs: `capture-pane`, stdout-only, `combined` format** | Task 5 | `stderr === ''`, `truncated === false`, `buildCombined` parity |
| **Logs: `sinceByteOffset`** | Task 7 | Covered |
| **Logs: empty before spawn** | Task 2 | Covered |
| **Logs: in-memory cache after session gone** | Task 5 | Covered |
| **Status: fresh snapshot** | Tasks 2–7 | Immutability not explicitly tested (minor) |
| **Status: crash detection (`has-session` / `pane_dead`)** | Task 7 | Covered |
| **Errors: `logs` resolves empty when no cache** | Task 2 | Pre-spawn empty; post-teardown cache in Task 5 |
| **#18 `spawn` contract** | Tasks 3–4, 6 | Reuse spawn→stop→spawn in Task 6 |
| **#18 `stop` contract** | Tasks 5–6 | |
| **#18 `logs` contract** | Tasks 2, 5, 7 | |
| **#18 `status` contract** | Tasks 2, 7 | |
| **Testing: `tmux-runner.test.ts` lifecycle list** | Tasks 2–7 | All spec-listed scenarios mapped |
| **Testing: `tmux-command.test.ts`** | Task 1 | Complete vs spec sanitization rules |
| **Testing: `tmux-isolation.test.ts`** | Task 8 | Runtime matcher with allowlist |
| **Testing: `runner-types.test.ts` barrel assignability** | Task 8 | `TmuxRunner` satisfies `Runner` |
| **Testing: optional integration** | — | Correctly deferred per spec |
| **Verification: `npm test` + `npm run build`** | Plan Verification | Present |
