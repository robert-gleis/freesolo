# Plan Review Round 1 — Issue #31

## Verdict
pass_with_findings

## Findings

### major — Subscriber `workflow.refused` payload `code` is not on `WorkflowEngineEvent`
- **What's wrong:** Task 5 subscriber tests assert append of `{ fromState, code, reason }`, but `WorkflowEngineEvent` decision events only carry `action: { kind: 'refuse', reason }` and `fromState` — there is no `code` field on the event stream (`src/workflow/engine.ts`). Refusal codes such as `no-state`, `malformed-state`, and `policy-refused` exist only on `TickResult.refused`, which the subscriber never sees.
- **What to change:** Add an explicit mapping rule in Task 5 Step 3 (e.g. default `code: 'refuse'` for all decision refuse events, or a small reason→code table for engine-internal refusals). Align subscriber tests with the chosen rule. If richer codes are required, note a follow-up to extend `WorkflowEngineEvent` rather than leaving implementers to guess.

### major — CLI `--limit` default will silently truncate timelines
- **What's wrong:** Spec requires `list` with limit default **1000** (`docs/freesolo/specs/2026-06-08-issue-31-design.md` CLI section). `EventLog.list` defaults to **100** (`query.limit ?? 100` in `src/event-log/store.ts`). Task 6 Step 3 says parse `--limit` but never tasks passing `limit: options.limit ?? 1000` into `list({ issueId, limit })`.
- **What to change:** In Task 6 Step 3, explicitly call `list({ issueId, limit: parsedLimit ?? 1000 })`. Add a CLI test that the default forwards 1000 (mock `list` and assert the query). Document that the store returns newest-first (`ORDER BY id DESC`); the builder re-sorts ascending, so the window is the **most recent N** events — acceptable for v1 but worth one line in Step 3 so implementers do not assume full history.

### major — Builder status-derivation rules from spec are underspecified and untested
- **What's wrong:** Spec defines non-trivial post-processing: `in_progress` (attempts exist, no successful completion, step is latest touched in pipeline order), `failed` (last attempt failed and no later step progressed), plus `startedAt` / `completedAt` derivation. Task 3 Step 3 says "derive per-step status" in one line without quoting these rules. No test covers `in_progress` or cross-step `failed` (e.g. review failed while verified is still pending).
- **What to change:** Paste the spec's four status rules into Task 3 Step 3 as numbered post-processing steps. Add builder tests: (1) partial pipeline with current step `in_progress`; (2) step `failed` with a later step still `pending`; (3) `startedAt` / `completedAt` populated from first and last successful attempts.

### major — Builder test plan omits several spec-mapped event paths
- **What's wrong:** Task 3 lists five scenarios but misses event types and error paths the spec requires: `team.planned` (maps to `planned`), `workflow.refused` (failed attempt on inferred step), `review.gate.completed` with `block` (same as `pass_with_findings`), malformed `workflow.transition` payload (skip defensively per spec Error Handling), and `plan.approved` alone without transitions (minimal activity / `hasActivity: true`).
- **What to change:** Extend Task 3 Step 1 with one test each for the missing paths. Include an assertion that a bad transition payload leaves step state unchanged and does not throw.

### minor — `approved` workflow state is unmapped in step mapping
- **What's wrong:** `WORKFLOW_STATES` includes `approved` between `planned` and `implementing` (`src/workflow/state-machine.ts`). Task 2 maps `planned` → `planned` but not `approved`. Engine transitions `planned → approved → implementing` would drop the intermediate transition from the timeline unless `approved` maps to `planned` (or another step).
- **What to change:** Decide and document in Task 2 Step 3: map `approved` → `planned` (recommended, consistent with planning-phase signals) or explicitly skip unmapped states with a comment. Add one `workflowStateToStepId('approved')` assertion.

### minor — No engine isolation guard for timeline / event-log imports
- **What's wrong:** Spec requires keeping the workflow engine free of SQLite/event-log coupling; persistence lives in `src/timeline/`. The plan does not task an isolation test. Repo precedent (`planner-engine-isolation.test.ts`, `integration-engine-isolation.test.ts`) guards `src/workflow/**` against importing other domains.
- **What to change:** Add Task 7 (or extend Task 5) with `timeline-engine-isolation.test.ts` using the existing `listTsFiles` + import-regex pattern, asserting no imports from `event-log` or `timeline` under `src/workflow/`.

### minor — Production CLI defaults not explicitly tasked
- **What's wrong:** Task 6 injects `openEventLog`, `write`, and `setExitCode` but does not task `defaultTimelineCommandDeps` wiring real `openEventLog` from `src/event-log/index.js` (pattern: `defaultVerifyPlanDeps` in `src/commands/verify.ts`, `CandidateCommandDeps` defaults in `src/commands/candidate.ts`).
- **What to change:** Add Task 6 Step 3 bullet exporting `defaultTimelineCommandDeps` and using it when `deps` is omitted in `registerTimelineCommands`.

### minor — `cli.test.ts` smoke test is thinner than peer command groups
- **What's wrong:** Task 6 adds only `expect(...).toContain('timeline')`. Other groups in `tests/unit/cli.test.ts` assert subcommands and option flags (e.g. `verify` checks `--issue`, `--config`; `state` checks `get` / `transition`).
- **What to change:** Extend the cli smoke test to assert `show` subcommand and flags `--issue`, `--json`, `--limit`, plus non-integer `--issue` rejection mirroring `verify`.

### minor — Render tests do not cover `in_progress` timestamp display
- **What's wrong:** Spec goal: "ISO-8601 timestamp on every completed, failed, or **in-progress** step." Task 4 render tests mention `✓` / `✗` / `pending` but not how an `in_progress` step prints (likely `startedAt`).
- **What to change:** Add a render fixture with one `in_progress` step and assert its ISO timestamp appears in text output (and in JSON fields).

### minor — Subscriber `workflowId` option untested
- **What's wrong:** Spec signature includes `options?: { workflowId?: string }` and `AppendEventInput.workflowId` exists, but Task 5 tests only assert `issueId` on append.
- **What to change:** Add a subscriber test that passes `workflowId` in options and asserts it is forwarded on `eventLog.append`.

### minor — Task 7 verification checklist omits `npm run build`
- **What's wrong:** TypeScript strict project; other freesolo plans include a build gate after unit tests. Task 7 runs `npm test` only.
- **What to change:** Add Step 1.5: `npm run build` — expect PASS.

## Notes

### Acceptance criteria coverage (spot-check)

| Criterion | Plan coverage | Gap |
|---|---|---|
| Timeline rendered for any issue with workflow activity | Tasks 3, 6 | Missing `team.planned` / minimal-activity builder test (finding #4) |
| Timestamps visible for each transition | Tasks 3–4 | `in_progress` display not tested (finding #9) |
| Failed / retried steps represented | Task 3 scenarios 3–5 | Missing `workflow.refused`, `block` gate, status-derivation tests (findings #3–4) |

### What looks good

- Module layout (`src/timeline/`, barrel, `src/commands/timeline.ts`) matches the spec and mirrors `src/event-log/`, `src/verification/`.
- Seven TDD tasks with explicit fail/pass gates, per-task commits, and no placeholder steps in implementation snippets.
- Type names align with spec: `TimelineStepId`, `buildTimeline(issueNumber, events)`, `createWorkflowEventSubscriber`, `renderTimelineText` / `renderTimelineJson`.
- Scope discipline matches non-goals: subscriber helper exported and tested, no auto-registration on the engine, no full factory emitter wiring.
- File structure and test file list match the spec architecture section verbatim.
- Task 6 CLI exit codes (`0` / `1` / `2`) and injectable deps follow established command-test patterns (`candidate-command.test.ts`, `verify-command.test.ts`).
- Event-log extension (Task 1) is minimal and correct — append-only types, no migration.

### Scope alignment

Plan correctly defers engine wiring in `src/commands/engine.ts` to follow-up work per spec. Self-review checklist is accurate for high-level coverage; the gaps above are in edge-case rules, integration field mapping, and CLI/store default alignment rather than missing modules.
