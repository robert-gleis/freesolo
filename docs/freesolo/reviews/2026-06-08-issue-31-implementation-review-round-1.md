# Implementation Review Round 1 — Issue #31

## Verdict
pass_with_findings

## Findings

1. **(minor)** `src/timeline/builder.ts:109-118` — `workflow.refused` without a resolvable `fromState` is silently ignored. The spec’s event table requires: *“Record `failed` attempt on step inferred from `fromState`, or current in-progress step.”* The builder only handles the explicit `fromState` path. In practice the subscriber always forwards `engineEvent.fromState`, so this mainly affects manually appended or legacy events; still a spec gap worth closing or documenting as deferred.

2. **(minor)** `tests/unit/timeline-builder.test.ts` — no test asserts `in_progress` status derivation end-to-end. Plan Task 3 scenario 11 called for a partial pipeline with an `in_progress` step; the implemented test *“marks the latest touched step in progress for partial pipelines”* instead expects `implemented` as `completed` (because `workflow.transition` records a completed attempt). `in_progress` is only exercised in `timeline-render.test.ts` via a hand-built fixture, not via `buildTimeline`. Add a builder fixture where the highest-touched step has failed-only attempts and a later pipeline step has completed (e.g. regression after forward progress) to lock the derivation rules.

3. **(minor)** `src/timeline/render.ts:32-34` — unreachable branch. Lines 21–24 already `continue` when `step.attempts.length === 0`, so the `in_progress && step.attempts.length === 0` block can never run. Safe to remove; no behavioural impact today.

4. **(nit)** `src/timeline/builder.ts:139-140` — `pr.created` detail uses `branchName` only; optional `url` from the payload is not surfaced in attempt detail. Spec lists both fields; low impact for v1 text output.

5. **(nit)** `tests/unit/timeline-command.test.ts` — covers `openEventLog` failure (exit 1) but not `list()` throwing inside `showAction` (also exit 1 per spec). The catch path in `showAction` exists; a one-line mock would close the gap.

## Notes

### Verification

| Check | Result |
|---|---|
| `npm test -- tests/unit/timeline-* tests/unit/event-log-types.test.ts tests/unit/cli.test.ts` | **PASS** — 8 files, 46 tests |
| `npm run build` | **PASS** |

### Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Timeline rendered for any issue with workflow activity | **Met** | `buildTimeline` sets `hasActivity` when any step has attempts; CLI exits 0 with text/JSON output when activity exists |
| Timestamps visible for each transition | **Met** | Every attempt carries `at` (event `createdAt`); text renderer prints ISO timestamps per attempt; JSON round-trip preserves fields |
| Failed / retried steps represented | **Met** | Builder tests cover `verification.failed`→`passed`, `review.gate.completed` findings/block, backward `workflow.transition`, and `workflow.refused` |

### Spec alignment

| Area | Status | Notes |
|---|---|---|
| Module layout (`src/timeline/*`, CLI, tests) | **Aligned** | Matches design architecture section |
| Four new `EVENT_TYPES` | **Aligned** | Appended after `decomposition.applied`; no migration |
| `buildTimeline` reducer + event mapping | **Mostly aligned** | All primary event types handled; malformed transitions skipped without throw; events sorted by `id` ascending |
| Status derivation | **Mostly aligned** | Four-rule post-processing implemented in `deriveStepFields`; `in_progress` path under-tested (finding #2) |
| Text + JSON renderers | **Aligned** | Header, padded labels, `✓`/`✗`/`pending`, continuation lines for multi-attempt steps |
| `createWorkflowEventSubscriber` | **Aligned** | Maps transition/refuse; constant `code: 'refuse'`; forwards `workflowId`; does not auto-register on engine |
| CLI `timeline show --issue <N> [--json] [--limit]` | **Aligned** | Exit 0/1/2; default limit 1000; injectable deps + `defaultTimelineCommandDeps` |
| Engine isolation | **Aligned** | `timeline-engine-isolation.test.ts` guards `src/workflow/**`; no reverse imports found |
| Non-goals | **Honoured** | Subscriber exported but not wired in `registerEngineCommands`; no GitHub UI; no backfill |

### Plan task checklist

| Task | Status |
|---|---|
| Task 1 — extend `EVENT_TYPES` | Done |
| Task 2 — types + step mapping | Done |
| Task 3 — `buildTimeline` reducer | Done (12 scenarios; `in_progress` derivation gap — finding #2) |
| Task 4 — renderers | Done |
| Task 5 — subscriber + barrel | Done; includes engine integration smoke test |
| Task 6 — CLI command | Done; `cli.test.ts` smoke tests for group, flags, invalid `--issue` |
| Task 7 — isolation guard + build | Done |

### Strengths

- Pure reducer core with defensive payload parsing — malformed events never throw.
- Backward transition retry semantics match the spec (`failStep` on regressed-from step, `completeStep` on target).
- Subscriber follows #23 append-only authority (log clock, no `createdAt` override in payload).
- CLI mirrors existing command patterns (`defaultTimelineCommandDeps`, Commander arg parsers, mandatory `--issue`).
- Engine isolation test uses the same recursive regex pattern as other workflow guards.
- Type exports and barrel are clean; production code has no `any`.

### Recommended follow-ups (non-blocking)

- Add builder test for `workflow.refused` with null/missing `fromState` once inference is implemented (or document v1 limitation).
- Remove dead render branch (finding #3).
- Wire `createWorkflowEventSubscriber` in `src/commands/engine.ts` in a follow-up ticket (explicit non-goal for #31).
