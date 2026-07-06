# Implementation Review — Issue #25 (Round 2)

## Verdict

pass

## Findings

No findings.

## Round 1 resolution

| Round 1 # | Severity | Topic | Status |
|---|---|---|---|
| 1 | Important | `send-keys` missing `--` option terminator | **Resolved** — `--` inserted before `spec.binary` in `tmux.ts`; unit test locks argv shape with binary `-l` and arg `--verbose` |
| 2 | Suggestion | Duplicate `buildCombined` helper | Open (non-blocking) |
| 3 | Suggestion | `stop()` from `starting` untested | Open (non-blocking) |
| 4 | Suggestion | `sanitizeSessionName` empty fallback undocumented | Open (non-blocking); behavior unchanged (`'runner'`) |
| 5 | Verification | Unrelated integration test failure | **Resolved** — full `npm test` now exits 0 (277 tests) |

### send-keys `--` verification

Implementation (spec spawn step 7):

```92:100:src/runners/tmux.ts
      const sendKeysArgs = [
        'send-keys',
        '-t',
        this.sessionName,
        '--',
        spec.binary,
        ...spec.args,
        'Enter'
      ];
```

Test asserts exact argv including `--` before flag-like tokens:

```90:112:tests/unit/tmux-runner.test.ts
    it('uses -- before binary so send-keys does not treat -flags as options', async () => {
      // ...
      await runner.spawn({ binary: '-l', args: ['--verbose'], cwd: '/tmp' });

      const sendKeys = calls.find((c) => c[0] === 'send-keys');
      expect(sendKeys).toEqual([
        'send-keys',
        '-t',
        'freesolo-r1',
        '--',
        '-l',
        '--verbose',
        'Enter'
      ]);
    });
```

## Acceptance criteria checklist

| Criterion | Status | Evidence |
|---|---|---|
| `TmuxRunner` implements every `Runner` method | **Pass** | Structural assignability in `runner-types.test.ts`; 20 lifecycle tests in `tmux-runner.test.ts` |
| Session naming: `freesolo-<sanitized-id>` with spec sanitization rules | **Pass** | `tmux-command.ts` + 5 tests in `tmux-command.test.ts` |
| Stale session: `has-session` → `kill-session` before `new-session` | **Pass** | `tmux.ts` spawn path; ordered mock test in `tmux-runner.test.ts` |
| Spawn precondition `idle`/`stopped`; `invalid-state` otherwise | **Pass** | Test: “rejects invalid-state when already running” |
| Spawn: `tmux -V`, `new-session`, `set-environment`, `send-keys --`, poll ≤2s | **Pass** | All steps implemented; `--` test added |
| Spawn failures → `spawn-failed`, state `error` | **Pass** | Tests for `-V` fail, `new-session` fail, poll timeout |
| Spawn not idempotent without `stop` | **Pass** | invalid-state test while `running` |
| Stop: `idle`/`stopped` no-op | **Pass** | “no-ops stop from idle” |
| Stop: `running`/`starting`/`error` → `stopping` → `stopped` | **Pass** | running + error paths tested; `starting` handled in implementation |
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
| `npm test` all green | **Pass** | 36 files, 277 tests, exit 0 |

## Verification

```
npm test   → exit 0 (277 passed)
npm run build → exit 0
```

Issue-#25 unit scope: 38 tests across `tmux-runner.test.ts` (20), `tmux-command.test.ts` (5), `tmux-isolation.test.ts` (1), `runner-types.test.ts` TmuxRunner barrel test, plus `runner-engine-isolation.test.ts` (3).

## Summary

Round 1’s only merge-blocking gap (`send-keys --`) is fixed and covered by a focused unit test. The implementation matches the design spec across spawn/stop/logs/status lifecycles, isolation constraints, and barrel export. Full test suite and build are green. Remaining round-1 suggestions are optional polish and do not block merge.
