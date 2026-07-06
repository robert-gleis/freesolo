# Issue #18 — Runner Interface Design

## Summary

Define a uniform TypeScript interface, `Runner`, that abstracts the *execution environment* in which an agent's host binary actually runs — local process, tmux pane, Docker container, future remote host. The workflow engine will eventually spawn agents through this interface and never touch `execa`, `child_process`, `tmux`, or container SDKs directly.

This ticket delivers the contract (`Runner` and its supporting types) plus one reference implementation, `ScriptedRunner`, that proves the interface is implementable and gives future engine code a deterministic test double. The ticket explicitly does **not** ship a tmux runner, a local-process runner, a Docker runner, or any engine wiring — each is its own ticket under epic #11.

Issue #18 is the structural counterpart to issue #33 (AgentAdapter): same shape of spec, same one-implementation strategy, orthogonal concern.

## Goals

- Make future engine code runtime-agnostic by isolating all runtime-specific knowledge behind an interface.
- Cover the spawn-stop-logs lifecycle called out in the issue, plus the observability requirements (identity, lifecycle state) from the acceptance criteria.
- Provide one concrete `Runner` implementation that exercises the interface and is usable as a test fixture for future engine tests.
- Keep the v1 surface intentionally small so real runners (local process, tmux, Docker) can be added without renegotiating the contract.

## Non-Goals

- **No tmux runner.** Listed in epic #11 as its own ticket.
- **No `LocalProcessRunner` with real `execa`.** Listed in epic #11 as its own ticket.
- **No Docker runner.** Listed in epic #11 as a future ticket.
- **No workflow-engine refactor.** Today, `src/workflow/engine.ts` does not spawn processes — it calls `AgentAdapter.start()` on a caller-provided adapter. There is no code path to migrate onto the Runner abstraction yet.
- **No refactor of `src/commands/start.ts:480` (the inline `execa` call).** That call is a one-shot CLI handoff — the user runs `freesolo start`, the CLI execs the host binary, and the CLI exits. It is not engine-driven supervision. Re-routing it through Runner is a natural follow-up after `LocalProcessRunner` lands, but not part of this ticket.
- **No streaming logs.** `logs()` returns a snapshot in v1. Streaming is deferred.
- **No process supervision.** No auto-restart, no crash recovery, no health checks. Owners of `Runner` instances do their own supervision.
- **No changes to `src/agents/` (`AgentAdapter`) or `src/adapters/` (`LaunchPlanBuilder`).** They solve different problems on orthogonal axes.

## Conceptual Place in the Architecture

`CONTEXT.md` distinguishes three orthogonal abstractions:

- **`LaunchPlanBuilder`** (`src/adapters/`) — synchronous, stateless: builds a `{ binary, args, cwd, postLaunchNote? }` *description* of what to launch for a specific host (claude / codex / cursor).
- **`AgentAdapter`** (`src/agents/`) — stateful, async: drives the protocol of an already-running agent (`start / stop / send / status`). One adapter wraps one running agent.
- **`Runner`** (`src/runners/`, this ticket) — stateful, async: owns the *execution environment* the host binary runs inside (`spawn / stop / logs / status`). One runner wraps one execution environment.

Composition at the call site is straightforward: `LaunchPlan` describes *what*, `Runner` does the *how* of spawning, and once the process is alive an `AgentAdapter` drives it through whatever protocol the host speaks. None of the three types import from another; the engine composes them.

## Architecture

New code lives under `src/runners/`:

```
src/runners/
  types.ts       # Runner, RunnerState, RunnerStatus, SpawnSpec, LogSnapshot, LogOptions, RunnerError
  scripted.ts    # ScriptedRunner — the reference / test-double runner
  index.ts       # Barrel re-export
```

Why a separate top-level directory:

- `src/adapters/` already exists for host launchers (LaunchPlanBuilders).
- `src/agents/` already exists for agent protocol adapters (AgentAdapter).
- `Runner` is the third orthogonal axis and gets its own home so future runtimes (`src/runners/local.ts`, `src/runners/tmux.ts`, `src/runners/docker.ts`) have an obvious place.

Engine and CLI code import only from `src/runners/index.ts`. Concrete implementations are never imported by the workflow engine — enforced today by review and by an isolation regression test (see Testing).

## Interface

```ts
// src/runners/types.ts

export type RunnerId = string;

export type RunnerState =
  | 'idle'      // runner constructed, spawn() never called
  | 'starting'  // spawn() in progress
  | 'running'   // spawned, host binary alive
  | 'stopping'  // stop() in progress
  | 'stopped'   // terminated cleanly
  | 'error';    // unrecoverable failure; only stop() is allowed

export interface RunnerStatus {
  state: RunnerState;
  startedAt?: Date;       // set once spawn transitions to running
  stoppedAt?: Date;       // set once stop transitions to stopped
  exitCode?: number;      // set on stopped or error; undefined while running
  error?: string;         // human-readable cause, set in error state
}

export interface SpawnSpec {
  binary: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;   // merged on top of inherited environment
}

export interface LogSnapshot {
  stdout: string;
  stderr: string;
  combined: string;       // interleaved, line-prefixed `[stdout] ...` / `[stderr] ...`
  truncated: boolean;     // true if an underlying ring-buffer cap was reached
}

export interface LogOptions {
  sinceByteOffset?: number;   // forward-compat tailing hook; v1 implementations may ignore
}

export interface Runner {
  readonly id: RunnerId;
  spawn(spec: SpawnSpec): Promise<void>;
  stop(): Promise<void>;
  logs(options?: LogOptions): Promise<LogSnapshot>;
  status(): Promise<RunnerStatus>;
}

export type RunnerErrorCode =
  | 'invalid-state'
  | 'spawn-failed'
  | 'stop-failed'
  | 'logs-unavailable';

export class RunnerError extends Error {
  readonly code: RunnerErrorCode;
  constructor(code: RunnerErrorCode, message: string) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
  }
}
```

### Method contracts

`spawn(spec)`
- Preconditions: state is `idle` or `stopped`. Any other state rejects with `RunnerError('invalid-state', ...)`.
- Transitions: `idle|stopped` → `starting` → `running` on success. On failure: → `error`, and the rejection carries the cause; `status.error` is set, `status.exitCode` may be set when the underlying runtime surfaces one.
- Idempotency: not idempotent. Calling `spawn` twice without an intervening `stop` is a contract violation and rejects with `invalid-state`.

`stop()`
- Preconditions: any state.
- Transitions: `running|starting|error` → `stopping` → `stopped`. From `idle` or `stopped`, resolves immediately as a no-op.
- Must not throw on a no-op stop. On a failed shutdown of a real runtime, transitions to `error` and rejects with `RunnerError('stop-failed', ...)`.
- Sets `stoppedAt` and `exitCode` once the runtime terminates.
- When the prior state was `error`, `stop()` preserves `status.error` so the cause remains observable on the final `stopped` snapshot.

`logs(options?)`
- Preconditions: none. Always resolves.
- Returns the captured stdout/stderr accumulated so far. Calling `logs` on an `idle` runner yields empty strings.
- `LogSnapshot.truncated` is `true` when a v2+ runner with a capped ring buffer has dropped earlier bytes.
- `LogOptions.sinceByteOffset` is reserved for tailing; v1 implementations may ignore it and return the full snapshot.
- Rejects with `RunnerError('logs-unavailable', ...)` only if the runtime *cannot* surface logs at all (rare; ScriptedRunner never rejects).

`status()`
- Preconditions: none. Always resolves.
- Returns a snapshot — callers may not assume the values stay current.

### Identity

`Runner.id: RunnerId` is a caller-provided string assigned at construction. Reasoning:

- Lets the engine (or test harness) label runners semantically — `"planner-#18"`, `"reviewer-round-2"` — without invoking a UUID generator inside Runner.
- Keeps `Runner` constructors deterministic: a test that constructs a runner with id `"r1"` can assert against logs and status without scraping a generated UUID.
- Real runners may store the id in a tmux session name, container label, or `ps` argv prefix — the value lives in the call site, not the runtime.

`RunnerId` is `string`. A future stricter brand (`type RunnerId = string & { readonly __brand: 'RunnerId' }`) can land later without breaking the v1 contract.

## Reference Runner: ScriptedRunner

Purpose: a deterministic test double that proves the interface is implementable, exercises every state transition, and will be reused by future engine tests as the canonical Runner fixture.

```ts
// src/runners/scripted.ts

export interface ScriptedRunnerScript {
  stdout?: string;          // returned in LogSnapshot.stdout after spawn
  stderr?: string;          // returned in LogSnapshot.stderr after spawn
  exitCode?: number;        // recorded on stop; defaults to 0
  spawnDelayMs?: number;    // ms to remain in `starting` before flipping to `running`; default 0
  failOnSpawn?: string;     // if set, spawn rejects with spawn-failed and runner enters `error`
}

export class ScriptedRunner implements Runner {
  readonly id: RunnerId;
  constructor(id: RunnerId, script?: ScriptedRunnerScript);
  // ...implements Runner
}
```

Behavior:

- `spawn(spec)`:
  - Rejects with `invalid-state` if state is not `idle` or `stopped`.
  - Flips state to `starting`, records `startedAt`.
  - If `failOnSpawn` is set, flips state to `error`, records `status.error = failOnSpawn`, and rejects with `RunnerError('spawn-failed', failOnSpawn)`. This is the only way ScriptedRunner can reach the `error` state — the test fixture's hook for exercising the documented `error → stopped` transition.
  - Otherwise: if `spawnDelayMs > 0`, awaits via `setTimeout` before flipping to `running`.
  - Stores `spec` internally so future v2 work can replay it; v1 does not use the stored spec beyond log assertions.
- `stop()`:
  - From `idle` or `stopped`: resolves immediately as a no-op.
  - From any other state (`starting`, `running`, `error`): flips to `stopping`, then to `stopped`, sets `stoppedAt`, sets `exitCode = script.exitCode ?? 0`.
- `logs()`:
  - Returns the pre-set `stdout` and `stderr` strings from the script, treated as opaque blobs.
  - `combined` is built by joining only the populated halves with a single `\n` separator, each prefixed by a stream tag on its own line. Concretely: if both halves are present, `combined === "[stdout]\n<stdout>\n[stderr]\n<stderr>"`. If only one is present, the other half (tag + body) is omitted. If neither is present, `combined === ""`. `truncated` is always `false`.
  - Returns empty `stdout`, `stderr`, and `combined` if `spawn` has not yet been called.
- `status()`:
  - Returns a fresh `RunnerStatus` object on every call, with `startedAt`, `stoppedAt`, `exitCode`, and `error` populated when they apply. Mutating the returned object does not affect future status reads.

ScriptedRunner owns no subprocess, no I/O, no filesystem state. Its only timer is the optional `spawnDelayMs` `setTimeout`. It exists to validate the contract and to be a deterministic fixture.

## Engine-Isolation Guarantee

The acceptance criterion **"Workflow engine is unaware of tmux (or any specific runtime)"** is satisfied trivially today: `src/workflow/engine.ts` and its peers contain no agent-spawning code and no tmux references.

A small clarification on what "runtime" means in this AC: the engine **does** use `execa` in `src/workflow/state-store.ts` to invoke the `gh` CLI for GitHub state-label CRUD. That is not an agent runtime — it is an external-service API call. The Runner abstraction governs *agent execution environments* (tmux pane, local process holding the agent, container hosting the agent), not arbitrary subprocess invocations of fixed external tooling. The AC's intent is preserved.

To prevent regressions, the spec adds an explicit constraint enforced by a regression test (see Testing):

> Files under `src/workflow/` must not import from `src/runners/` and must not contain the identifier `tmux`. When the engine eventually needs to spawn a host binary, it accepts a caller-provided `Runner` instance (analogous to how it already accepts an `AgentAdapter`) and calls only the interface methods.

When the engine starts *consuming* `Runner` in a follow-up ticket, the first guard (no imports from `src/runners/`) will be relaxed to "may import only from `src/runners/index.ts`, and only types/interfaces — never concrete classes". The second guard (no `tmux` identifier) stays in force forever.

This is the runner-side mirror of issue #33's engine-isolation constraint for AgentAdapter.

## CLI `start.ts` Note

`src/commands/start.ts` ends with:

```ts
await execa(result.launchPlan.binary, result.launchPlan.args, {
  cwd: result.launchPlan.cwd,
  stdio: 'inherit'
});
```

This call is intentionally **out of scope**. It is a CLI handoff: the user types `freesolo start`, the CLI execs the host binary inheriting stdio, the CLI process exits. There is no supervision, no log capture, no lifecycle to abstract — once `execa` returns, the CLI is done. Routing it through a `Runner` would be ceremony without benefit until we actually need supervised lifecycle (which arrives with `LocalProcessRunner` or whatever ticket first makes the CLI hold the agent's lifecycle).

## Acceptance Criteria Mapping

| Issue criterion | Where it is satisfied |
|---|---|
| Workflow engine is unaware of tmux (or any specific runtime) | Trivially true today (engine has no spawn code). Forward-looking constraint plus `runner-engine-isolation.test.ts` enforce it going forward. |
| Interface covers spawn, stop, and log retrieval | `Runner.spawn / Runner.stop / Runner.logs` declared with full contracts (preconditions, transitions, errors). |
| At least one runner implementation can be slotted in behind the interface | `ScriptedRunner` implements every method of `Runner`, is exercised by unit tests, and is fit-for-purpose as a future engine test fixture. |
| Runner identity and lifecycle state are observable | `Runner.id` (identity) plus `Runner.status(): RunnerStatus` carrying `state`, `startedAt`, `stoppedAt`, `exitCode`, and `error`. |

## Testing

Unit tests live under `tests/unit/`, matching existing repo convention.

- `tests/unit/runner-types.test.ts`
  - Type-only sanity: `ScriptedRunner` is assignable to `Runner`. Confirms `id` is a readable property, methods match arity, and `RunnerError.code` narrows to `RunnerErrorCode`.
- `tests/unit/scripted-runner.test.ts`
  - Fresh runner reports `idle` with no `startedAt` / `stoppedAt`.
  - `spawn` moves to `running`, sets `startedAt`, `exitCode` undefined.
  - `spawn` from `running` rejects with `invalid-state`.
  - `spawn` honours `spawnDelayMs` (state is `starting` mid-flight, `running` after).
  - `spawn` with `failOnSpawn` set rejects with `RunnerError('spawn-failed', ...)` and leaves the runner in `error` with `status.error` populated.
  - `stop` from `running` moves to `stopped`, sets `stoppedAt` and `exitCode` from the script.
  - `stop` from `idle` is a no-op (state remains `idle`, resolves).
  - `stop` from `stopped` is a no-op.
  - `stop` from `error` (reached via `failOnSpawn`) moves to `stopped` — the documented `error → stopping → stopped` transition.
  - `logs` before `spawn` returns empty strings, `truncated: false`.
  - `logs` after `spawn` returns the scripted stdout/stderr with the documented `combined` formatting.
  - Re-using a runner: `spawn` → `stop` → `spawn` is allowed.
  - `status` returns a fresh snapshot on every call (mutating the returned object does not affect later calls).
- `tests/unit/runner-engine-isolation.test.ts`
  - Reads every `.ts` file under `src/workflow/`.
  - Asserts no file contains an import string that targets `src/runners/`: matches `from '../runners'`, `from '../../runners'`, `from '../runners/...'`, etc. via a regex.
  - Asserts no file contains the substring `tmux` (case-insensitive).
  - Does **not** assert anything about `execa` or `child_process`: those are general subprocess primitives, already in legitimate non-agent use under `src/workflow/state-store.ts` to invoke `gh`. The Runner AC is about agent runtimes, not external CLIs.

No integration tests are required for this ticket: there is no subprocess, no filesystem state, no network I/O. Real runners in follow-up tickets will introduce integration coverage when they introduce real side-effects.

## Backwards Compatibility

This change is purely additive:

- New directory `src/runners/`. No existing module imports from it yet.
- No changes to public exports of `src/agents/`, `src/adapters/`, `src/workflow/`, `src/commands/`, or `src/core/`.
- No changes to `package.json` dependencies. ScriptedRunner uses only the Node standard library.

## Open Decisions

None for v1. The "real runner" follow-up tickets (`LocalProcessRunner`, `TmuxRunner`) will decide whether the v1 interface needs to grow (likely candidates: streaming logs, structured exit information, per-runtime metadata such as tmux pane id or container id). Those decisions belong to those tickets.

## Risks

- **Real-runner shape may force interface changes.** Acceptable — v1 is intentionally minimal, and concrete runners will land iteratively. Each follow-up ticket may propose adding fields (never removing) once it has a real implementation in hand.
- **Caller-provided `RunnerId` shifts uniqueness responsibility to callers.** If two callers pick the same id, the runtime cannot detect it. Acceptable for v1; an in-process registry can be added when engine-side multiplexing exists.
- **`logs()` as snapshot only.** If future engine code wants to stream agent output to a UI, it will need `logStream(): AsyncIterable<LogChunk>` alongside `logs()`. v1 keeps the surface minimal and defers.

## Recommendation

Ship the interface and `ScriptedRunner` as described. Keep the v1 surface small so concrete runners (local process, tmux, Docker) can land iteratively under epic #11 without renegotiating the contract.
