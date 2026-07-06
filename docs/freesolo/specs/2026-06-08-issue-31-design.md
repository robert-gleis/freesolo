# Issue #31 — Workflow Timeline Design

**Issue:** [#31 — Workflow Timeline](https://github.com/robert-gleis/freesolo/issues/31)
**Parent:** #15 — Epic: Observability
**Builds on:** #23 (Agent Event Log, merged), #24 (Workflow Engine, merged)
**Status:** Draft, awaiting user review

## Summary

Add a **workflow timeline** that projects an issue's lifecycle from the append-only event log into an ordered list of human-readable steps with timestamps. v1 ships a pure `buildTimeline(events)` reducer, a text/JSON renderer, four new canonical event types for workflow telemetry that existing emitters can adopt incrementally, a composition helper that persists `WorkflowEngine` in-memory events to the log, and `freesolo timeline show --issue <N>` for operators and scripts.

The timeline answers: *where is this issue in the factory, what happened when, and where did it fail or retry?*

## Goals

- Render a timeline for any issue that has at least one relevant event in the log.
- Show an ISO-8601 timestamp on every completed, failed, or in-progress step.
- Represent failed and retried steps — not just the happy path — via attempt records on each step.
- Keep the workflow engine free of SQLite imports; persistence wiring lives in `src/timeline/` at the composition root.
- Expose a stable JSON shape for future Session Replay (#15 sibling ticket) and dashboards.

## Non-Goals

- **Full emitter wiring across the factory.** v1 adds event types + the engine subscriber helper; instrumenting verification, review loops, PR creation, etc. in their owning tickets is follow-up work once the types exist.
- **GitHub UI or web dashboard.** CLI text + JSON only.
- **Cross-host replication or remote aggregation.** Timeline reads the local `~/.freesolo/state.db` like the event log.
- **Replacing `freesolo state get`.** Label-based state remains authoritative for engine decisions; timeline is derived observability.
- **Historical backfill from GitHub labels or artifacts.** Timeline reflects logged events only.

## Considered Options

### A. Timeline reducer over event log + new workflow event types (recommended)

Extend `EVENT_TYPES` with `workflow.transition`, `workflow.refused`, `review.gate.completed`, and `pr.created`. A pure `buildTimeline(issueNumber, events)` maps events chronologically into five canonical display steps aligned with the issue example: **Planned → Implemented → Reviewed → Verified → PR Created**. Existing events (`plan.approved`, `team.planned`, `verification.passed`, `verification.failed`) participate via a mapping table. A `createWorkflowEventSubscriber(eventLog)` helper persists engine `transition` / `decision` events at the composition root.

**Pros:** Matches #23's deferred-subscriber pattern; testable pure core; works today with partial emitters and improves as more events land.
**Cons:** Timeline completeness depends on callers adopting the new types (documented in Non-Goals).

### B. Derive timeline only from existing v1 event types

**Rejected:** Current types cannot distinguish Implemented vs Reviewed vs PR Created; would fail acceptance criteria for failed/retried workflow steps.

### C. Read GitHub `state:*` labels and merge with events

**Rejected:** Labels show current state only — no history, no failure/retry detail, and no timestamps for transitions.

## Architecture

```
src/timeline/
  types.ts           # TimelineStep, TimelineAttempt, Timeline, step ids + labels
  steps.ts           # CANONICAL_STEPS ordered list, state → step mapping
  builder.ts         # buildTimeline(issueNumber, events) — pure reducer
  render.ts          # renderTimelineText, renderTimelineJson
  subscriber.ts      # createWorkflowEventSubscriber(eventLog)
  index.ts           # barrel

src/event-log/
  types.ts           # extend EVENT_TYPES (4 new types)

src/commands/
  timeline.ts        # registerTimelineCommands — show

tests/unit/
  timeline-steps.test.ts
  timeline-builder.test.ts
  timeline-render.test.ts
  timeline-subscriber.test.ts
  timeline-command.test.ts
  event-log-types.test.ts (modify — new types)
  cli.test.ts (modify — register timeline group)
```

Why `src/timeline/`:

- Epic #15 groups Observability concerns; Session Replay (#15 sibling) will likely reuse the same projection types.
- Mirrors `src/event-log/`, `src/verification/` — read-side domain separate from persistence.
- Engine isolation preserved: `src/workflow/` does not import `src/timeline/`.

### Canonical timeline steps

Fixed display order (matches issue example):

| Step id | Label | Primary signals |
|---|---|---|
| `planned` | Planned | `plan.approved`, `team.planned`, `workflow.transition` → `planned` |
| `implemented` | Implemented | `workflow.transition` → `implementing`, backward retry from `reviewing`/`verifying` |
| `reviewed` | Reviewed | `workflow.transition` → `reviewing`, `review.gate.completed` |
| `verified` | Verified | `verification.passed`, `verification.failed` |
| `pr-created` | PR Created | `pr.created`, `workflow.transition` → `pr-ready` |

Each step carries:

```ts
export type TimelineStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TimelineAttempt {
  at: string;           // ISO-8601
  status: 'completed' | 'failed';
  detail?: string;      // e.g. refusal reason, gate status, conflict message
  eventId: number;
}

export interface TimelineStep {
  id: TimelineStepId;
  label: string;
  status: TimelineStepStatus;
  attempts: TimelineAttempt[];
  /** Timestamp of first activity on this step */
  startedAt: string | null;
  /** Timestamp when step reached completed (last successful attempt) */
  completedAt: string | null;
}

export interface Timeline {
  issueNumber: number;
  steps: TimelineStep[];
  /** True when at least one mapped event was processed */
  hasActivity: boolean;
}
```

### Event → timeline rules (chronological, ascending by `event.id`)

Events are sorted **oldest first** before reduction.

| Event type | Payload fields used | Effect |
|---|---|---|
| `plan.approved`, `team.planned` | — | Record `completed` attempt on `planned` |
| `workflow.transition` | `from`, `to` (WorkflowState strings) | Map `to` to step id via `steps.ts`; record `completed` on target step; if `from` is later in pipeline than `to`, record `failed` attempt on the regressed-from step then `completed` on target (retry semantics) |
| `workflow.refused` | `code`, `reason`, optional `fromState` | Record `failed` attempt on step inferred from `fromState`, or current in-progress step |
| `verification.failed` | optional `detail` | Record `failed` attempt on `verified` |
| `verification.passed` | — | Record `completed` on `verified` |
| `review.gate.completed` | `gate`, `round`, `status` | On `pass_with_findings` or `block`: `failed` on `reviewed`; on `pass`: `completed` on `reviewed` |
| `pr.created` | optional `branchName`, `url` | Record `completed` on `pr-created` |
| `agent.created`, `agent.stopped`, `issue.assigned`, `decomposition.applied` | — | Ignored for v1 display (telemetry only) |

**Status derivation per step:**

- `pending` — no attempts
- `in_progress` — has attempts but no successful `completed` attempt and step is the latest touched step in pipeline order
- `completed` — last attempt is `completed`
- `failed` — last attempt is `failed` and no later step has progressed

### New event types

Add to `EVENT_TYPES` in `src/event-log/types.ts`:

```ts
'workflow.transition',  // payload: { from: WorkflowState, to: WorkflowState }
'workflow.refused',     // payload: { fromState: WorkflowState | null, code: string, reason: string }
'review.gate.completed',// payload: { gate: 'plan' | 'implementation', round: number, status: ReviewGateStatus }
'pr.created',           // payload: { branchName?: string, url?: string }
```

No SQLite migration — `event_type` is unconstrained TEXT validated at append time.

### Workflow engine subscriber

```ts
export function createWorkflowEventSubscriber(
  eventLog: EventLog,
  options?: { workflowId?: string }
): (event: WorkflowEngineEvent) => void;
```

Maps:

- `{ kind: 'transition', from, to, issueNumber, at }` → append `workflow.transition` with `createdAt` from `at` (tests inject `now` on log; subscriber passes payload timestamps only — **append uses log clock**, matching #23 append-only authority; subscriber called synchronously during tick so clocks match)
- `{ kind: 'decision', action: { kind: 'refuse', reason }, ... }` → append `workflow.refused`

Does **not** auto-register on the engine — callers wire `engine.on(subscriber)` at composition root (`src/commands/engine.ts` is the natural first adopter in a follow-up; v1 exports the helper + tests only to keep #31 scope bounded).

### CLI

```
freesolo timeline show --issue <N> [--json] [--limit <n>]
```

- Opens default event log (`openEventLog()`).
- Lists events filtered by `issueId`, limit default 1000 (clamp per log API).
- Builds timeline; prints text to stdout or JSON with `--json`.
- Exit `0` when `hasActivity`; exit `2` when no mapped events (empty timeline).
- Exit `1` on log errors.

**Text format** (example):

```
Issue #123

Planned          2026-06-08T10:00:00.000Z ✓
Implemented      2026-06-08T11:30:00.000Z ✓
Reviewed         2026-06-08T12:00:00.000Z ✗ (round 2: pass_with_findings)
                 2026-06-08T13:00:00.000Z ✓
Verified         2026-06-08T14:00:00.000Z ✓
PR Created       pending
```

Failed attempts show `✗` with optional detail; successful completion shows `✓`. Pending steps show `pending`.

## Error Handling

| Condition | Behavior |
|---|---|
| No events for issue | `hasActivity: false`; CLI exit 2 |
| Unknown stored event type on read | Propagate `EventLogError` from store (existing behaviour) |
| Malformed transition payload | Skip event in builder (defensive — do not throw; step unchanged) |
| Empty event list passed to builder | Return all steps `pending`, `hasActivity: false` |

## Testing Strategy

| Test file | Covers |
|---|---|
| `timeline-steps.test.ts` | `workflowStateToStepId`, canonical order |
| `timeline-builder.test.ts` | Happy path full pipeline; verification fail then pass; review gate retry; backward transition retry; empty input |
| `timeline-render.test.ts` | Text layout with timestamps; JSON round-trip |
| `timeline-subscriber.test.ts` | transition + refused events appended with correct types/payloads |
| `timeline-command.test.ts` | CLI exit codes, `--json`, injectable deps |
| `event-log-types.test.ts` | New types in `EVENT_TYPES` |

## Acceptance Criteria Mapping

| Criterion | How verified |
|---|---|
| Timeline rendered for any issue with workflow activity | Builder + CLI tests with fixture events; `hasActivity: true` |
| Timestamps visible for each transition | Every attempt carries `at`; text renderer prints ISO timestamps |
| Failed / retried steps represented | Builder tests for `verification.failed`, `review.gate.completed` with findings, backward `workflow.transition` |

## Related

- #23 — Agent Event Log (prerequisite)
- #24 — Workflow Engine (event source for subscriber)
- #15 — Epic: Observability (Session Replay sibling)
- ADR-0001 — local SQLite telemetry layout

## Recommendation

Option A: pure timeline reducer + four new event types + subscriber helper + CLI. Delivers inspectable workflow history from the event log without coupling the engine to SQLite, and leaves incremental emitter wiring to downstream tickets.
