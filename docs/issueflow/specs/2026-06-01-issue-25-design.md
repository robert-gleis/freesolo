# Issue #25 — Tmux Runner Design

**Issue:** [#25 — Implement Tmux Runner](https://github.com/robert-gleis/issueflow/issues/25)  
**Parent:** [#11 — Epic: Runner Abstraction](https://github.com/robert-gleis/issueflow/issues/11)  
**Builds on:** [#18 — Create Runner Interface](https://github.com/robert-gleis/issueflow/issues/18) (merged)  
**Status:** Draft

## Summary

Ship `TmuxRunner`, a concrete `Runner` implementation that spawns host binaries inside detached tmux sessions, captures pane output for `logs()`, and tears sessions down on `stop()`. All tmux-specific knowledge (session naming, pane lifecycle, `capture-pane`, `kill-session`) lives under `src/runners/` and nowhere else.

**Repo reality check:** At implementation time the codebase contains **no** existing tmux calls — only the isolation regression test that forbids `tmux` under `src/workflow/`. The issue body’s “move existing tmux-based execution” describes the epic intent (decouple callers from tmux), not a literal pre-existing module to relocate. This ticket therefore **introduces** the tmux backend as the first real runner rather than refactoring scattered call sites. The acceptance criterion “all current tmux usage routes through the runner interface” is satisfied by making `TmuxRunner` the sole production tmux touchpoint.

## Goals

- Implement `TmuxRunner` satisfying every `Runner` method contract from issue #18.
- Encapsulate session naming, pane spawn, log capture, and teardown inside `src/runners/tmux.ts` (plus a small injectable command helper).
- Keep `src/workflow/` free of `tmux` identifiers and concrete runner imports (existing `runner-engine-isolation.test.ts` must keep passing).
- Provide deterministic unit tests via dependency injection (no real tmux required in CI).
- Export `TmuxRunner` from `src/runners/index.ts` for future engine/CLI wiring.

## Non-Goals

- **Wiring `issueflow start` through `TmuxRunner`.** Issue #18 explicitly leaves `start.ts`’s one-shot `execa` handoff out of scope; that path has no supervision or log capture. A future ticket may choose tmux vs local process at the CLI layer.
- **Workflow-engine integration.** The engine still does not spawn agents via `Runner`; no changes under `src/workflow/engine.ts`.
- **`LocalProcessRunner` (#26).** Separate ticket; must not be implemented here.
- **Streaming logs.** `logs()` remains snapshot-only per the v1 `Runner` contract.
- **Attaching to pre-existing user tmux sessions.** `TmuxRunner` owns sessions it creates; it does not adopt foreign sessions.
- **Changing the `Runner` interface.** If tmux forces a v2 extension (e.g. metadata), that is a follow-up — this ticket implements within the current contract.

## Approaches Considered

| Approach | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Monolithic `tmux.ts`** — all execa calls inline | Fewest files | Hard to test, mixes orchestration and argv building | Reject |
| **B. `TmuxRunner` + injectable `TmuxCommandRunner`** | Testable, mirrors verification-runner deps pattern | Two files | **Chosen** |
| **C. Shared `TmuxClient` npm package** | Reusable | New dependency, overkill | Reject |

## Architecture

```
src/runners/
  tmux.ts           # TmuxRunner class (implements Runner)
  tmux-command.ts   # session name sanitization, argv builders, default execa-backed runner
  index.ts          # re-export TmuxRunner
```

`TmuxRunner` accepts optional `TmuxRunnerDeps`:

- `runTmux(args: string[]): Promise<TmuxExecResult>` — default wraps `execa('tmux', args, { reject: false })`.
- `now(): () => Date` — for `startedAt` / `stoppedAt` in tests.

No file outside `src/runners/tmux*.ts` may contain the identifier `tmux` (enforced by a new unit test).

### Session naming

- Derived from `runner.id`: `issueflow-<sanitized-id>`.
- Sanitization: lowercase; replace any character outside `[a-z0-9-]` with `-`; collapse repeated hyphens; trim leading/trailing hyphens; truncate to 200 chars (tmux limit is 255; leave headroom for prefix).
- Before `spawn`, if `has-session` reports the target name already exists, `kill-session` it (stale session from a prior crashed runner) then proceed.

### Spawn lifecycle

1. **Precondition:** state is `idle` or `stopped`; else `RunnerError('invalid-state', ...)`.
2. Set state `starting`, record `startedAt`.
3. Verify tmux is invokable (`tmux -V` exit 0); on failure → `error` + reject `spawn-failed`.
4. Ensure session name is free (kill stale if needed).
5. `new-session -d -s <name> -c <spec.cwd>`.
6. Apply `spec.env` via `set-environment -t <name> KEY VALUE` for each entry (empty env skipped).
7. Start the process: `send-keys -t <name> -- <binary> <args...> Enter` using tmux’s per-argument quoting (no shell interpolation).
8. Brief poll (≤ 2s, 50ms steps) until session exists and pane is not dead; on timeout → kill session, `error`, `spawn-failed`.
9. Set state `running`.

`spawn` is **not** idempotent across concurrent calls; second `spawn` without `stop` rejects.

### Stop lifecycle

1. From `idle` / `stopped`: no-op resolve.
2. From `running` / `starting` / `error`: set `stopping`.
3. Read `#{pane_exit_status}` via `list-panes -F` when session still exists (best-effort exit code).
4. `kill-session -t <name>` (ignore “can't find session” on already-dead).
5. Set `stopped`, `stoppedAt`, `exitCode` (default 0 if unknown), preserve `error` message when stopping from `error` state.

### Logs

- `capture-pane -p -t <name> -S -` (full scrollback).
- Tmux panes do not split stdout/stderr; captured text goes in `LogSnapshot.stdout`, `stderr` is `''`.
- `combined` uses the same `[stdout]` / `[stderr]` formatting as `ScriptedRunner`.
- `sinceByteOffset` slices the captured stdout string (and thus combined) from that byte offset; `truncated` is always `false` in v1.
- Before first successful `spawn`, return empty strings (same as `ScriptedRunner`).
- If session is gone and runner never captured logs, return last cached capture from in-memory buffer updated on each `logs()` call while running.

### Status and crash detection

- `status()` always resolves a fresh snapshot.
- While `running`, if `has-session` is false OR pane `#{pane_dead}` is `1`, transition to `stopped` with `exitCode` from `#{pane_exit_status}` when available (parse as integer, else `1`).
- `starting` → `stopped` if pane dies during poll window (treated as spawn failure path already handled).

### Errors

| Situation | Code | State after |
|---|---|---|
| `spawn` from wrong state | `invalid-state` | unchanged |
| tmux missing / `new-session` fails | `spawn-failed` | `error` |
| `stop` when `kill-session` fails unexpectedly | `stop-failed` | `error` |
| `logs` when session gone and no cache | resolves empty (not `logs-unavailable`) | — |

## Acceptance Criteria Mapping

| Issue criterion | Where satisfied |
|---|---|
| All current tmux usage routes through the runner interface | No other production tmux call sites; only `src/runners/tmux*.ts` |
| No regressions in existing tmux-driven flows | N/A today; unit tests lock behavior |
| Tmux-specific concerns encapsulated inside the runner | Session naming, pane spawn/capture/kill only in `tmux.ts` / `tmux-command.ts` |

## Testing

- `tests/unit/tmux-runner.test.ts` — full lifecycle with mocked `runTmux`: idle/spawn/stop/logs/status, invalid-state, spawn-failed, stop from error, `sinceByteOffset`, crash detection, stale-session cleanup, combined log format.
- `tests/unit/tmux-command.test.ts` — `sanitizeSessionName` edge cases.
- `tests/unit/tmux-isolation.test.ts` — assert `tmux` identifier appears only under `src/runners/tmux*.ts` and `tests/**` (workflow isolation test unchanged).
- Optional `tests/integration/tmux-runner.test.ts` — runs only when `tmux -V` succeeds; skipped otherwise. Not required for CI green.

## Backwards Compatibility

Additive: new files + barrel export. No changes to `Runner` types, workflow engine, or CLI behavior.

## Open Decisions

None — v1 uses snapshot logs and caller-provided ids as established in #18.

## Recommendation

Implement approach **B** with injectable tmux execution, ship unit tests first (TDD), and defer CLI/engine wiring to a follow-up ticket that explicitly chooses a default runner backend.
