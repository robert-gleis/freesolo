# Implementation Review — Issue #25 (Round 1)

## Verdict

pass_with_findings

## Findings

### Important

1. **`send-keys` omits the `--` option terminator required by the spec.** The design (spawn step 7) documents `send-keys -t <name> -- <binary> <args...> Enter` so tmux does not treat binary or argument tokens starting with `-` as `send-keys` flags. The implementation passes binary and args directly after `-t <session>` without `--`:

```92:99:src/runners/tmux.ts
      const sendKeysArgs = [
        'send-keys',
        '-t',
        this.sessionName,
        spec.binary,
        ...spec.args,
        'Enter'
      ];
```

   Add `--` before `spec.binary` and a unit test with a binary or arg like `-l` to lock the argv shape.

### Suggestions

2. **Duplicate `buildCombined` helper.** `tmux.ts` and `scripted.ts` each define an identical `buildCombined`. Extracting a shared helper under `src/runners/` would keep combined-log formatting in one place if the format ever changes.

3. **`stop()` from `starting` is untested.** The spec groups `starting` with `running`/`error` for stop transitions. Implementation handles it (state is neither `idle` nor `stopped`), but no test exercises stop mid-poll. Low risk given the `if (this.state === 'starting')` guard before promoting to `running`.

4. **`sanitizeSessionName` empty fallback is undocumented.** When sanitization yields an empty string, the helper returns `'runner'` (session `freesolo-runner`). Reasonable for tmux, but not spelled out in the spec; consider a one-line comment or test if empty ids are possible from callers.

### Verification notes

5. **Full `npm test` exits 1 due to an unrelated integration failure.** All issue-#25 unit tests pass (37 across `tmux-*.test.ts`, `runner-types.test.ts`, `runner-engine-isolation.test.ts`). `npm run build` exits 0. The sole failure is `tests/integration/verify-command.test.ts` → “records SIGINT on the running check when a real subprocess is killed” (`expected 'skipped' to be 'fail'`). No tmux files touch verify/start/workflow paths; this failure is environmental or pre-existing and not introduced by this implementation.

## Acceptance criteria checklist

| Criterion | Status | Evidence |
|---|---|---|
| `TmuxRunner` implements every `Runner` method | **Pass** | Structural assignability in `runner-types.test.ts`; 19 lifecycle tests in `tmux-runner.test.ts` |
| Session naming: `freesolo-<sanitized-id>` with spec sanitization rules | **Pass** | `tmux-command.ts` + 5 tests in `tmux-command.test.ts` |
| Stale session: `has-session` → `kill-session` before `new-session` | **Pass** | `tmux.ts` spawn path; ordered mock test in `tmux-runner.test.ts` |
| Spawn precondition `idle`/`stopped`; `invalid-state` otherwise | **Pass** | Test: “rejects invalid-state when already running” |
| Spawn: `tmux -V`, `new-session`, `set-environment`, `send-keys`, poll ≤2s | **Pass with finding** | All steps implemented; `--` on `send-keys` missing (Finding #1) |
| Spawn failures → `spawn-failed`, state `error` | **Pass** | Tests for `-V` fail, `new-session` fail, poll timeout |
| Spawn not idempotent without `stop` | **Pass** | invalid-state test while `running` |
| Stop: `idle`/`stopped` no-op | **Pass** | “no-ops stop from idle” |
| Stop: `running`/`starting`/`error` → `stopping` → `stopped` | **Pass** | running + error paths tested; `starting` implied |
| Stop: `pane_exit_status` best-effort, `kill-session`, ignore missing session | **Pass** | `readPaneExitStatus`; stderr guard for `can't find session` |
| Stop failure → `stop-failed`, state `error` | **Pass** | “rejects stop-failed when kill-session fails” |
| Stop from `error` preserves `error` message | **Pass** | Dedicated test |
| Re-spawn after `stop` allowed | **Pass** | “allows spawn after stop” |
| Logs: `capture-pane`, stdout only, `truncated: false`, ScriptedRunner combined format | **Pass** | Test asserts `[stdout]\n` combined shape |
| Logs: empty before first spawn | **Pass** | idle test |
| Logs: in-memory cache after session gone | **Pass** | “returns cached logs after session is gone” |
| Logs: `sinceByteOffset` slicing | **Pass** | “honors sinceByteOffset” |
| Status: crash detection (`pane_dead` / missing session) → `stopped` | **Pass** | “transitions to stopped when pane dies while running” |
| Injectable deps (`runTmux`, `now`) | **Pass** | `TmuxRunnerDeps`, `defaultTmuxRunnerDeps`, timestamp tests |
| Export `TmuxRunner` from `src/runners/index.ts` | **Pass** | Barrel export + type export |
| Tmux runtime usage only under allowed `src/` paths | **Pass** | `tmux-isolation.test.ts` with runtime regex + allowlist |
| No workflow leakage (`src/workflow/` free of tmux / runner imports) | **Pass** | `runner-engine-isolation.test.ts` (3 tests); no `tmux` under `src/workflow/` |
| No CLI/engine wiring (non-goal) | **Pass** | No changes under `src/commands/` or `src/workflow/engine.ts` |
| `npm run build` succeeds | **Pass** | `tsc` + `ensure-bin-executable` exit 0 |
| `npm test` all green | **Partial** | Tmux scope green; 1 unrelated integration failure (Finding #5) |

## Plan task coverage

All eight plan tasks are implemented: session helpers (Task 1), skeleton + idle (Task 2), spawn happy path (Task 3), spawn failures (Task 4), stop/logs/cache (Task 5), stop edge cases + reuse (Task 6), `sinceByteOffset` + crash detection (Task 7), barrel + isolation + structural test (Task 8).

## Summary

The implementation faithfully delivers the planned `TmuxRunner` state machine with strong mocked unit coverage, correct `Runner` contract behavior, and proper encapsulation/isolation. The only spec-level gap worth addressing before merge is the missing `--` on `send-keys`. Full-suite CI may still report red until the unrelated verify integration test is fixed or stabilized.
