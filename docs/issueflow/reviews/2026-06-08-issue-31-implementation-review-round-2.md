# Implementation Review Round 2 — Issue #31

## Verdict
pass

## Findings

None.

## Round 1 Remediation

| # | Severity | Finding | Status | Evidence |
|---|---|---|---|---|
| 1 | minor | `workflow.refused` without resolvable `fromState` silently ignored | **Fixed** | `inferInProgressStepId()` in `src/timeline/builder.ts:154-184`; fallback at lines 114-117; test *"maps workflow.refused without fromState onto the inferred in-progress step"* in `tests/unit/timeline-builder.test.ts:189-200` |
| 2 | minor | No builder test for `in_progress` status derivation end-to-end | **Fixed** | Test *"derives in_progress when the highest touched step has only failed attempts"* in `tests/unit/timeline-builder.test.ts:172-187` |
| 3 | minor | Unreachable `in_progress && attempts.length === 0` branch in renderer | **Fixed** | Dead branch removed from `src/timeline/render.ts`; renderer now handles `pending`, empty attempts, and attempt iteration only |
| 4 | nit | `pr.created` detail omitted optional `url` | **Fixed** | `src/timeline/builder.ts:142-147` joins `branchName` and `url` with ` — ` |
| 5 | nit | CLI test missing `list()` throw path | **Fixed** | Test *"exits 1 when listing events throws"* in `tests/unit/timeline-command.test.ts:110-134` |

## Notes

### Verification

| Check | Result |
|---|---|
| `npm test -- tests/unit/timeline-* tests/unit/event-log-types.test.ts` | **PASS** — 7 files, 37 tests |
| `npm run build` | **PASS** |

### Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| Timeline rendered for any issue with workflow activity | **Met** | `buildTimeline` sets `hasActivity` when any step has attempts; CLI exits 0 with text/JSON output when activity exists |
| Timestamps visible for each transition | **Met** | Every attempt carries `at` (event `createdAt`); text renderer prints ISO timestamps per attempt; JSON round-trip preserves fields |
| Failed / retried steps represented | **Met** | Builder tests cover verification fail→pass, review gate retry/block, backward transitions, `workflow.refused` with and without `fromState`, and `in_progress` after failed-only highest step |

### Spec alignment

| Area | Status | Notes |
|---|---|---|
| Module layout (`src/timeline/*`, CLI, tests) | **Aligned** | Matches design architecture section |
| Four new `EVENT_TYPES` | **Aligned** | Appended after `decomposition.applied`; no migration |
| `buildTimeline` reducer + event mapping | **Aligned** | All primary event types handled; `workflow.refused` infers step when `fromState` absent; malformed transitions skipped without throw |
| Status derivation | **Aligned** | Four-rule post-processing in `deriveStepFields`; `in_progress` covered by builder test |
| Text + JSON renderers | **Aligned** | Header, padded labels, `✓`/`✗`/`pending`, continuation lines for multi-attempt steps |
| `createWorkflowEventSubscriber` | **Aligned** | Maps transition/refuse; constant `code: 'refuse'`; forwards `workflowId`; not auto-registered on engine |
| CLI `timeline show --issue <N> [--json] [--limit]` | **Aligned** | Exit 0/1/2; default limit 1000; both `openEventLog` and `list()` error paths tested |
| Engine isolation | **Aligned** | `timeline-engine-isolation.test.ts` guards `src/workflow/**` |
| Non-goals | **Honoured** | Subscriber exported but not wired in `registerEngineCommands`; no GitHub UI; no backfill |

### Plan task checklist

| Task | Status |
|---|---|
| Task 1 — extend `EVENT_TYPES` | Done |
| Task 2 — types + step mapping | Done |
| Task 3 — `buildTimeline` reducer | Done — 14 scenarios including `in_progress` and refused inference |
| Task 4 — renderers | Done |
| Task 5 — subscriber + barrel | Done |
| Task 6 — CLI command | Done |
| Task 7 — isolation guard + build | Done |

### Strengths (unchanged from round 1)

- Pure reducer core with defensive payload parsing — malformed events never throw.
- Backward transition retry semantics match the spec.
- Subscriber follows #23 append-only authority.
- CLI mirrors existing command patterns with injectable deps.
- Engine isolation guard in place; production code has no `any`.
