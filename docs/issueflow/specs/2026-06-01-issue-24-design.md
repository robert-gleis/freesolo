# Issue #24 — Create Workflow Engine Design

**Issue:** [#24 — Create Workflow Engine](https://github.com/robert-gleis/issueflow/issues/24)
**Parent:** #7 — Epic: Make IssueFlow the Factory Controller
**Builds on:** #17 (Workflow State Machine, merged) and #33 (Agent Adapter Interface, merged)
**Status:** Draft, awaiting user review

## Summary

Add the central workflow engine that drives an IssueFlow-managed GitHub issue through its lifecycle. The engine reads the issue's current state from the state machine, asks a pluggable policy what to do next, takes the action, and writes the resulting state transition. Every decision and every transition is emitted as a typed event. The engine refuses to act when state is missing, ambiguous, or terminal, and surfaces the refusal as a structured result the caller can react to. Because state is persisted on GitHub labels, the engine is stateless between calls — restart recovery is implicit.

## Goals

- Be the single component that advances an issue through workflow states. No other code in this repository writes `state:*` labels in production paths.
- Make the next-action decision an explicit, pluggable policy that returns a typed `EngineAction`. The engine itself contains no per-state if/else for what to do.
- Emit a typed event for every decision and every transition so observers can log, persist, or react.
- Survive process restart without losing work: the engine reads state from GitHub every tick and resumes from whatever is observable now.
- Refuse to act on issues whose state is missing, malformed, terminal, or whose requested transition is invalid. Refusals are visible in the return value and in the event stream.
- Support driving an `AgentAdapter` (#33) when a policy returns a `spawn` action, without baking any concrete adapter into the engine.

## Non-Goals

- **Real team orchestration.** The issue body says "spawns teams"; v1 spawns at most one `AgentAdapter` per tick. Multi-agent team orchestration is a separate ticket.
- **Concrete agent adapters.** The engine works against the `AgentAdapter` interface only. Real Pi/Claude Code/Codex adapters land in their own tickets.
- **Long-running daemon supervision.** The engine exposes `tick(issueNumber)`. Looping, polling, scheduling, retry/backoff, and process supervision belong to a future runner ticket.
- **Modifying `session.json#currentStage`.** That field describes an agent's intra-session sub-stage (`issue-intake`, `brainstorming`, …). The engine works on GitHub-level workflow states (`triaged`, `planned`, …) and does not touch the session file.
- **Webhook-driven reactivity.** Out of scope. The engine reacts to direct calls from a future runner; the runner ticket can add webhook plumbing.
- **Migrating existing issues.** The engine only acts on issues that already carry a `state:*` label. Bootstrapping uses the existing `ensureStateLabels` helper.

## Architecture

```
src/workflow/
  state-machine.ts      # existing — pure transition table
  state-store.ts        # existing — gh-backed read/writeState
  engine.ts             # new — orchestrator: tick, events, refusal handling
  policy.ts             # new — pure decide(state, context) → EngineAction
```

The engine is a small factory function plus a `WorkflowEngine` object. It depends only on three injected concerns:

- `stateStore` — `{ readState, writeState }`, defaulting to `src/workflow/state-store.ts`.
- `policy` — `(input: PolicyInput) => EngineAction`, defaulting to the v1 policy in `src/workflow/policy.ts`.
- `agent` — optional `AgentAdapter`. When the policy returns a `spawn` action, the engine calls `agent.start(...)` then `agent.send(...)` once, then leaves the adapter running. If no adapter is configured and the policy returns `spawn`, the engine refuses.

The engine owns no domain decisions of its own. Its job is mechanical: read, ask policy, act, emit, return. This keeps the unit small and testable.

## Public API

```ts
// src/workflow/engine.ts

import type { AgentAdapter, AgentStartInput } from '../agents/index.js';
import type { RepoRef, WorkflowState } from './state-machine.js';

export type EngineAction =
  | { kind: 'transition'; to: WorkflowState }
  | { kind: 'wait'; reason: string }
  | { kind: 'spawn'; agent: AgentTaskRequest; nextState: WorkflowState }
  | { kind: 'refuse'; reason: string };

export interface AgentTaskRequest {
  workingDirectory: string;
  initialInstructions: string;
}

export type EngineRefusalCode =
  | 'no-state'
  | 'terminal-state'
  | 'invalid-transition'
  | 'no-agent-adapter'
  | 'policy-refused'
  | 'malformed-state';

export interface TickResult {
  issueNumber: number;
  fromState: WorkflowState | null;
  action: EngineAction;
  toState: WorkflowState | null;
  refused?: { code: EngineRefusalCode; reason: string };
}

export type WorkflowEngineEvent =
  | { kind: 'decision'; at: Date; issueNumber: number; fromState: WorkflowState | null; action: EngineAction }
  | { kind: 'transition'; at: Date; issueNumber: number; from: WorkflowState; to: WorkflowState };

export interface WorkflowEngineDeps {
  readState: (repo: RepoRef, issue: number) => Promise<WorkflowState | null>;
  writeState: (repo: RepoRef, issue: number, from: WorkflowState, to: WorkflowState) => Promise<void>;
  policy: (input: PolicyInput) => EngineAction;
  agent?: AgentAdapter;
  now?: () => Date;
}

export interface PolicyInput {
  state: WorkflowState;
  issueNumber: number;
  repo: RepoRef;
}

export interface WorkflowEngine {
  tick(input: { repo: RepoRef; issueNumber: number }): Promise<TickResult>;
  on(handler: (event: WorkflowEngineEvent) => void): () => void;
}

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine;
```

### `tick` contract

1. Call `readState(repo, issue)`.
2. If `readState` throws (e.g. `MultipleStateLabelsError`, `InvalidStateLabelError` from #17), wrap the cause in a refusal `{ code: 'malformed-state' }` and emit a single `decision` event with action `refuse`. Return a `TickResult` carrying the refusal. Never let those errors propagate out of `tick`.
3. If `readState` returns `null` → refusal `{ code: 'no-state' }`. Emit, return.
4. If the state is `closed` → refusal `{ code: 'terminal-state' }`. Emit, return.
5. Otherwise call `policy({ state, issueNumber, repo })`.
6. Emit one `decision` event carrying the policy's action.
7. Dispatch on the action kind:
   - `wait` or `refuse` → return immediately, no state change.
   - `transition { to }` → call `writeState(repo, issue, currentState, to)`. If `assertTransition` throws inside `writeState`, surface as refusal `{ code: 'invalid-transition' }` (no transition event emitted, `decision` was already emitted). On success, emit a `transition` event and return with `toState: to`.
   - `spawn { agent: { workingDirectory, initialInstructions }, nextState }` → if no `agent` adapter is configured, refusal `{ code: 'no-agent-adapter' }`. Otherwise: `agent.start({ workingDirectory, initialInstructions })` then `agent.send(initialInstructions)` once. Then perform the transition to `nextState` exactly as the `transition` branch (with the same refusal/event semantics).

`tick` never throws. All paths return a `TickResult`. Caller-visible errors only happen for unexpected dependency failures (e.g., `writeState` raising a `MultipleStateLabelsError` that isn't `InvalidTransitionError`) — those propagate.

### `on` contract

`on(handler)` registers a synchronous subscriber and returns an unsubscribe function. Multiple subscribers are supported. The engine emits events in tick order; a subscriber that throws is caught and its error is swallowed (an engine that crashes because a logger throws is worse than a missed log line).

## Policy Layer

`src/workflow/policy.ts` exports the default policy `defaultPolicy(input: PolicyInput) → EngineAction`:

| State           | Default action                                                      |
|-----------------|---------------------------------------------------------------------|
| `triaged`       | `wait` — spec/plan work happens in agent sessions; engine waits     |
| `planned`       | `wait` — awaiting user approval (out-of-band)                       |
| `approved`      | `wait` — agent picks up implementation in its session               |
| `implementing`  | `wait` — agent is working                                           |
| `reviewing`     | `wait` — review/fix loop running                                    |
| `verifying`     | `wait` — verification running                                       |
| `pr-ready`      | `wait` — operator opens the PR                                      |
| `merged`        | `{ kind: 'transition', to: 'closed' }` — auto-close after merge     |
| `closed`        | (engine never reaches policy — terminal short-circuit)              |

The v1 policy is deliberately conservative: it only auto-transitions `merged → closed`. Every other state is a `wait` because the actual work is done by agents in their own sessions, and the engine's job in v1 is to be present, observable, and ready, not to be opinionated about timing.

The policy is exported as a pure function. Tests substitute their own policies to drive every action kind through the engine without needing per-state fixtures.

## Event System

The engine maintains an in-process list of subscribers and notifies them synchronously inside `tick`. No persistence in v1. A caller that wants a persistent event log subscribes a writer (e.g., `engine.on(event => fs.appendFile('events.ndjson', JSON.stringify(event) + '\n'))`). This keeps the engine free of file I/O and lets the future runner ticket choose its own persistence story.

Two event kinds:

- **`decision`** — exactly one per tick, even on refusal. Carries `fromState`, `issueNumber`, the policy `action`, and the wall-clock `at`.
- **`transition`** — emitted only after a successful `writeState`. Carries `from`, `to`, `issueNumber`, `at`.

Order guarantee: for a given tick, the `decision` event always fires before the `transition` event.

## Persistence & Resumability

The engine itself stores nothing on disk. Every tick re-derives the world:

1. `readState` queries GitHub.
2. Policy is pure and runs in-process.
3. `writeState` writes GitHub.

Restart recovery is therefore implicit: a fresh process calls `tick` and continues. No reconciliation step is needed. A caller that lost track of which issue it was working on can list all issues with `state:*` labels (via `gh issue list --label`) and tick each.

For the `spawn` action: the engine starts an agent and sends one message, then writes the transition to `nextState`. The transition is the durable record. If the engine crashes between `agent.start` and `writeState`, the next tick observes the still-old state and re-attempts. Agent adapters are responsible for being idempotent on their side (the `ScriptedAgentAdapter` already is — calling `start` twice is `invalid-state`, not a corruption).

## Refusing Invalid States

The engine refuses by returning a `TickResult` whose `refused` field is populated. Six refusal codes:

| Code                 | Trigger                                                                |
|----------------------|------------------------------------------------------------------------|
| `no-state`           | `readState` returned `null` (no `state:*` label).                      |
| `malformed-state`    | `readState` threw `MultipleStateLabelsError` or `InvalidStateLabelError`. |
| `terminal-state`     | Current state is `closed`.                                             |
| `invalid-transition` | `writeState` rejected the transition (`InvalidTransitionError`).       |
| `no-agent-adapter`   | Policy returned `spawn` but no adapter was configured.                 |
| `policy-refused`     | Policy returned `{ kind: 'refuse', reason }`.                          |

Every refusal still emits the `decision` event so observers see why nothing happened. `invalid-transition` is the one case where the policy proposed a real transition that the state machine rejected — the engine catches that and surfaces it as a refusal rather than letting `InvalidTransitionError` escape `tick`.

## CLI Surface

A single new CLI command, gated symmetrically with `issueflow state transition`:

```
issueflow engine tick --issue <number>
```

- Requires `ISSUEFLOW_ENGINE=1` (the same gate the state-transition command uses). Without it, the command prints a clear error and exits with code `3`.
- On success: prints a one-line summary to stdout — e.g. `merged -> closed (transition)`, `implementing (wait: agent session in progress)`, `triaged refused: no-state`. Exit code `0`.
- On refusal: prints the refusal code and reason to stderr. Exit code matches the refusal: `2` for `no-state`/`terminal-state`/`policy-refused` (observational refusals), `1` for `invalid-transition`/`no-agent-adapter` (configuration errors), `4` for `malformed-state` (mirrors the existing state-CLI behaviour).
- The CLI does not configure an agent adapter — the default invocation operates without `spawn` support. A future runner ticket wires the real adapter.

Registered under `src/cli.ts` alongside `state`.

## Errors

The engine intentionally does not introduce a new error class. All recoverable cases are surfaced as `TickResult.refused`. The only errors that escape `tick` are unexpected I/O failures from `readState`/`writeState` that the engine does not know how to interpret — those are bugs and should crash the caller loudly. `InvalidTransitionError` (from #17) is caught and translated to `invalid-transition` refusal; `MultipleStateLabelsError` and `InvalidStateLabelError` (from #17) are caught and translated to `malformed-state` refusal.

## Testing

Unit tests live under `tests/unit/`, matching project convention. All tests inject fake deps — no `gh` calls, no real adapters, no network.

- **`tests/unit/workflow-engine.test.ts`**
  - `tick` returns `refused: no-state` when `readState` resolves `null`.
  - `tick` returns `refused: malformed-state` when `readState` throws `MultipleStateLabelsError`.
  - `tick` returns `refused: malformed-state` when `readState` throws `InvalidStateLabelError`.
  - `tick` returns `refused: terminal-state` when state is `closed`.
  - `tick` returns the policy's `wait` reason as-is.
  - `tick` honours a `transition` action — calls `writeState` with `(from, to)`, emits a `transition` event, returns `toState: to`.
  - `tick` translates `InvalidTransitionError` from `writeState` into `refused: invalid-transition`.
  - `tick` returns `refused: no-agent-adapter` when policy returns `spawn` and no adapter is configured.
  - `tick` with a `spawn` action: calls `agent.start` with the request, calls `agent.send` once with the initial instructions, then calls `writeState` to `nextState`, emits both `decision` and `transition` events.
  - `tick` emits exactly one `decision` event per call, including on refusal.
  - `tick` emits `transition` events only after successful `writeState`.
  - Multiple subscribers each receive every event.
  - A subscriber that throws does not break the engine: the subscriber's exception is swallowed and the tick still returns its result.
  - `tick` never throws for any of the typed errors from #17.

- **`tests/unit/workflow-policy.test.ts`**
  - The default policy returns `transition: closed` for `merged`.
  - The default policy returns `wait` for every other non-terminal state.
  - The default policy is total: every `WorkflowState` produces an `EngineAction` (drive the test from `WORKFLOW_STATES`).

- **`tests/unit/engine-command.test.ts`** (new) and **`tests/unit/cli.test.ts`** (modify)
  - `engine tick` requires `ISSUEFLOW_ENGINE=1`; without it, prints an engine-gate error and exits `3`.
  - `engine tick` happy path: when a stub engine returns a transition result, the CLI prints the one-line summary and exits `0`.
  - `engine tick` refusal paths: exit codes map to the refusal code as described in the CLI section.

No integration tests against a real GitHub repo or a real agent process. The interface contracts in #17 and #33 are already covered by their own tests; the engine ticket adds no new I/O contracts.

## Acceptance Criteria Mapping

| Criterion from issue                                                  | How this design satisfies it                                                                                       |
|-----------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| Engine is the single source of truth for issue execution              | Every state advance flows through `engine.tick`; no other module calls `writeState` in production paths.            |
| Engine can resume after restart with no lost work                     | `tick` is stateless. State lives on GitHub labels (#17). A fresh process resumes by calling `tick` on the same issue. |
| Engine emits events for every decision and transition                 | `decision` event per tick (always); `transition` event per successful state write. Subscribers register via `engine.on`. |
| Engine refuses to act on issues in invalid states                     | `tick` returns a `TickResult.refused` for `no-state`, `malformed-state`, `terminal-state`, `invalid-transition`, `no-agent-adapter`, `policy-refused`. |

## Risks & Open Questions

- **Policy needs richer context.** v1 policy only sees `state`. Real-world policies will want PR status, branch presence, last-event timestamp, etc. The `PolicyInput` shape is intentionally minimal; adding fields later is non-breaking because consumers receive the object by name.
- **`spawn` action shape may change.** The `AgentTaskRequest` mirrors `AgentStartInput` from #33. If `AgentAdapter` grows (streaming, structured responses), the spawn shape grows with it. v1 accepts the small surface area.
- **No retry/backoff.** A `writeState` that fails for a transient network reason currently escapes `tick`. A runner ticket will own retry semantics; the engine stays predictable and one-shot.
- **No PR-or-merge sensors.** The default policy `wait`s on `pr-ready`. A future ticket will add a sensor (PR-status reader) and let the policy advance `pr-ready → merged` automatically. The interface is ready: just enrich `PolicyInput`.

## Recommendation

Ship the engine exactly as described: a small, stateless, event-emitting orchestrator with a pluggable policy and an optional agent adapter. The minimal surface lets the parent epic's later tickets — real adapters, team orchestration, runner supervision — plug in without rewriting the engine.
