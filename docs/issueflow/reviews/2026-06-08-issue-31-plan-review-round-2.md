# Plan Review Round 2 — Issue #31

## Verdict
pass

## Findings

No new findings. All eleven round 1 items are addressed in the updated plan.

## Notes

### Round 1 remediation summary

| Round 1 # | Severity | Finding | Status |
|---|---|---|---|
| 1 | major | Subscriber `workflow.refused` payload `code` not on `WorkflowEngineEvent` | **Resolved** — Task 5 Step 1 documents constant `code: 'refuse'`; Step 3 maps `{ fromState, code: 'refuse', reason: event.action.reason }`. |
| 2 | major | CLI `--limit` default silently truncates at store default 100 | **Resolved** — Task 6 Step 1 asserts default forwards 1000; Step 3 calls `list({ issueId, limit: parsedLimit ?? 1000 })` and documents newest-first window + builder re-sort. |
| 3 | major | Builder status-derivation rules underspecified and untested | **Resolved** — Task 3 Step 3 lists four numbered post-processing rules; tests 11–13 cover `in_progress`, cross-step `failed`, and `startedAt` / `completedAt`. |
| 4 | major | Builder test plan omits spec-mapped event paths | **Resolved** — Task 3 Step 1 expanded to 13 scenarios: `team.planned`, `workflow.refused`, `review.gate.completed` with `block`, malformed transition (no throw), `plan.approved` alone, plus original happy-path and retry cases. |
| 5 | minor | `approved` workflow state unmapped | **Resolved** — Task 2 test asserts `workflowStateToStepId('approved') === 'planned'`; Step 3 documents planning-phase mapping. |
| 6 | minor | No engine isolation guard | **Resolved** — File structure lists `timeline-engine-isolation.test.ts`; Task 7 Step 1 mirrors `worktree-engine-isolation.test.ts` regex pattern. |
| 7 | minor | Production CLI defaults not tasked | **Resolved** — Task 6 Step 3 exports `defaultTimelineCommandDeps` wiring `openEventLog` from `src/event-log/index.js`. |
| 8 | minor | `cli.test.ts` smoke test thinner than peers | **Resolved** — Task 6 Step 3 tasks `show` subcommand, flags `--issue` / `--json` / `--limit`, and non-integer `--issue` rejection. |
| 9 | minor | Render tests omit `in_progress` timestamp | **Resolved** — Task 4 Step 1 requires `in_progress` step prints `startedAt` ISO timestamp. |
| 10 | minor | Subscriber `workflowId` option untested | **Resolved** — Task 5 Step 1 asserts `workflowId` from options forwarded on append. |
| 11 | minor | Task 7 omits `npm run build` | **Resolved** — Task 7 Step 4 runs `npm run build` with PASS expectation. |

### Spec alignment (spot-check)

| Spec area | Plan coverage | Notes |
|---|---|---|
| Module layout (`src/timeline/`, CLI, tests) | Tasks 1–7 | Matches design architecture section |
| Four new `EVENT_TYPES` | Task 1 | No migration; append-time validation only |
| `buildTimeline` reducer + event mapping | Task 3 | 13 scenarios cover spec table and error-handling rows |
| Status derivation (`pending` / `in_progress` / `completed` / `failed`) | Task 3 Step 3 | Rules now explicit and tested |
| Text + JSON renderers | Task 4 | Includes multi-attempt layout and `in_progress` timestamps |
| `createWorkflowEventSubscriber` | Task 5 | Refuse code mapping, `workflowId` forwarding, no auto-registration |
| CLI `timeline show --issue <N> [--json] [--limit]` | Task 6 | Exit codes 0/1/2, limit default 1000, injectable deps + production defaults |
| Engine isolation (no event-log/timeline imports in `src/workflow/`) | Task 7 | Matches repo precedent |
| Acceptance criteria (activity, timestamps, failure/retry) | Tasks 3–6 | Gaps from round 1 closed |

### Optional hardening (non-blocking)

- **`workflow.refused` with null `fromState`:** Spec allows inferring the step from the current in-progress step when `fromState` is absent. Task 3 test 8 covers explicit `fromState: 'reviewing'` only. Implementers can follow the spec rule during Task 3 Step 3; a follow-on builder test for null `fromState` would lock the inference path but is not required for v1 given explicit `fromState` is the primary engine subscriber shape.
- **Task 3 test 11 wording:** The bullet combines “`plan.approved` only” with “`implemented` `in_progress` when followed by incomplete transition” — read as two related scenarios (minimal activity, then partial forward progress). Clear enough for implementation; could be split into two bullets for readability.

### What looks good

- Round 1 feedback drove concrete, verifiable edits — not just prose acknowledgments. Each major gap now has an explicit task step and a named test.
- Self-Review section accurately reflects post-fix coverage (event types, status derivation, CLI limit, isolation, render/subscriber edge cases).
- TDD structure, per-task commits, file layout, and scope discipline (subscriber exported but not auto-wired to engine) remain strong and aligned with the design doc non-goals.
