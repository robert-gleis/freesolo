# Issue #26 — Local Process Runner Design

**Issue:** [#26 — Implement Local Process Runner](https://github.com/robert-gleis/issueflow/issues/26)
**Parent:** #11 — Epic: Runner Abstraction
**Builds on:** #18 Create Runner Interface (merged)
**Status:** Draft, awaiting user review

## Summary

Ship `LocalProcessRunner`, a concrete `Runner` implementation that supervises a real host binary as a child process on the local machine — no tmux, no containers. The runner owns piped stdout/stderr capture, graceful shutdown, and detection when the child exits on its own. It proves the #18 abstraction works with a second backend and establishes the log-format contract that the future `TmuxRunner` (#25) must match from a caller's perspective.

## Goals

- Implement every `Runner` method against a real subprocess spawned via `execa`.
- Capture stdout and stderr incrementally into in-memory buffers and expose them through `logs()` as a `LogSnapshot` with the same field names and `combined` formatting as `ScriptedRunner`.
- Honour the full lifecycle contract from issue #18: state transitions, `RunnerError` codes, idempotent `stop()`, and reuse after `stop()`.
- Detect unexpected child exit while in `running` (crash / natural completion) and transition to `stopped` with `exitCode` set so callers can poll `status()`.
- Keep workflow-engine isolation unchanged: no imports from `src/runners/` under `src/workflow/`.

## Non-Goals

- **No tmux runner (#25).** Tmux will wrap existing behaviour later; this ticket does not touch tmux.
- **No workflow-engine wiring.** The engine still does not spawn agents through `Runner`; callers construct `LocalProcessRunner` in tests or future runner tickets.
- **No refactor of `src/commands/start.ts` handoff `execa`.** Still a one-shot CLI exit; supervised lifecycle is out of scope until a ticket explicitly needs it.
- **No streaming logs.** `logs()` remains snapshot-only per the v1 interface.
- **No log persistence to disk.** Buffers are in-memory only for the process lifetime.
- **No changes to `Runner` types** unless a concrete gap is discovered during implementation (additive fields only).

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **A. `execa` subprocess with piped stdio** | Already a project dependency; handles argv, cwd, env; cross-platform | Must wire exit/crash listeners carefully | **Recommended** |
| B. Raw `node:child_process.spawn` | No extra abstraction | Duplicates execa conveniences; more boilerplate | Rejected |
| C. Detached process + log files on disk | Survives parent exit | Breaks in-memory `LogSnapshot` contract; cleanup complexity | Rejected |

## Architecture

New and touched files:

```
src/runners/
  log-format.ts     # shared buildCombined(stdout, stderr) — extracted from scripted.ts
  local.ts          # LocalProcessRunner
  scripted.ts       # import buildCombined from log-format.ts (no behaviour change)
  index.ts          # export LocalProcessRunner

tests/unit/
  log-format.test.ts
  local-process-runner.test.ts
```

`LocalProcessRunner` mirrors `ScriptedRunner`'s internal state machine shape (private `state`, timestamps, exit metadata) but drives a real `execa` child instead of script knobs.

### Subprocess options

```ts
const child = execa(spec.binary, spec.args, {
  cwd: spec.cwd,
  env: { ...process.env, ...spec.env },
  stdio: ['ignore', 'pipe', 'pipe'],
  reject: false,           // spawn errors surface via failed spawn, not thrown execa
  cleanup: false,          // we own stop() semantics
  forceKillAfterDelay: false
});
```

- Stdin is ignored (agents are non-interactive from the runner's perspective in v1).
- `reject: false` keeps spawn failures inside `spawn()`'s try/catch as `RunnerError('spawn-failed', ...)`.

### Log capture

- Append chunk data to private `stdoutBuffer` and `stderrBuffer` (`Buffer` or string accumulation).
- Optional cap `maxLogBytes` (default **1_048_576**, constructor override for tests) across **both** streams combined. When exceeded, drop oldest bytes FIFO-style and set `truncated: true` on subsequent `logs()` calls.
- `buildCombined()` in `log-format.ts` produces the canonical `[stdout]\n…` / `[stderr]\n…` shape documented in #18 — identical to `ScriptedRunner` so callers cannot distinguish backends from `LogSnapshot` alone.
- `LogOptions.sinceByteOffset` remains ignored in v1 (forward-compat).

### Lifecycle

**`spawn(spec)`**

- Preconditions: `idle` or `stopped`; else `RunnerError('invalid-state', ...)`.
- Transitions: → `starting` (set `startedAt`) → on successful child start → `running`.
- On spawn failure (binary missing, `EACCES`, etc.): → `error`, set `status.error`, reject `spawn-failed`.
- Register `child.stdout` / `child.stderr` `'data'` handlers before awaiting the microtask that confirms the process started.
- Register `child.on('exit', (code, signal))` **once** per spawn.

**Unexpected exit (`exit` while `running` or `starting`)**

- If `stop()` has not been initiated, transition directly to `stopped` (skip visible `stopping` — there is nothing to wait on).
- Set `stoppedAt`, `exitCode` from `code ?? (signal ? 128 : 0)` (documented mapping), clear handlers.
- Do **not** enter `error` for non-zero exit codes — those are normal process outcomes. `error` remains for spawn/stop failures per #18.

**`stop()`**

- From `idle` / `stopped`: no-op, resolves.
- From `running` / `starting` / `error`: → `stopping`, send `SIGTERM`, await graceful window (**5_000 ms**, constructor override for tests), then `SIGKILL` if still alive, await final `exit`, → `stopped` with `stoppedAt` and `exitCode`.
- On stop failure (cannot signal process): → `error`, reject `stop-failed`.
- When prior state was `error`, preserve `status.error` on the final `stopped` snapshot (same as `ScriptedRunner`).

**`logs()` / `status()`**

- Same contracts as #18. `logs()` always resolves unless we add a future `logs-unavailable` path (not expected for local processes).

### Constructor

```ts
export interface LocalProcessRunnerOptions {
  maxLogBytes?: number;
  stopGraceMs?: number;
}

export class LocalProcessRunner implements Runner {
  readonly id: RunnerId;
  constructor(id: RunnerId, options?: LocalProcessRunnerOptions);
}
```

Optional injectable `spawnProcess` dep for unit tests (mirrors patterns elsewhere): defaults to wrapping `execa`, allows tests to supply a fake child with controllable streams and exit timing without hitting the real OS for every assertion.

## Acceptance Criteria Mapping

| Issue criterion | Where satisfied |
|-----------------|-----------------|
| Agents run as local processes without tmux | `LocalProcessRunner` uses `execa` child only; no tmux imports anywhere in `src/runners/local.ts`. |
| Log capture works the same as tmux runner from caller's perspective | Shared `buildCombined`; `LogSnapshot` field parity with `ScriptedRunner`; integration-style unit tests assert `combined` shape. #25 will conform to this runner's output, not vice versa. |
| Process lifecycle (spawn, stop, crash detection) is reliable | State machine tests: happy-path spawn/stop, stop during `starting`, unexpected exit while `running`, non-zero exit code surfaced on `status`, double-spawn rejected. |

## Testing

Unit tests in `tests/unit/local-process-runner.test.ts`:

- Use short-lived real processes where cheap (`node -e "…"`, `sleep` with tight timeouts).
- Use injectable `spawnProcess` fake for race-sensitive cases (exit during `starting`, stop escalation).
- Cases:
  - idle → spawn → running with `startedAt`
  - logs empty before spawn; populated after child writes
  - `combined` formatting matches scripted golden strings
  - truncated flag when output exceeds small `maxLogBytes` in tests
  - spawn twice without stop → `invalid-state`
  - stop from idle/stopped is no-op
  - stop terminates a long-running child
  - child exits on its own while running → `stopped` + `exitCode`
  - spawn invalid binary → `error` + `spawn-failed`
  - spawn → stop → spawn reuse allowed
  - `status()` returns fresh snapshots

`tests/unit/log-format.test.ts` pins `buildCombined` edge cases (both streams, one stream, empty).

Existing `scripted-runner.test.ts` must remain green after extracting `buildCombined`.

`runner-engine-isolation.test.ts` unchanged — still passes.

## Backwards Compatibility

Additive only: new files + `index.ts` export + refactor `scripted.ts` to import shared helper (no observable behaviour change).

## Open Decisions

None. `maxLogBytes` default and `stopGraceMs` default are fixed constants in the spec; tests may override via constructor options.

## Risks

- **Flaky timing tests** — Mitigate with injectable spawn fake for races; reserve real-process tests for deterministic short scripts.
- **Buffer memory** — 1 MiB default cap prevents runaway agents from OOMing the supervisor; document in constructor JSDoc.

## Recommendation

Ship Approach A: `execa` + piped capture + shared `buildCombined`, with injectable spawn for reliable unit tests.
