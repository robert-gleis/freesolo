# Issue #45 — Autonomous Team Creation Design

**Issue:** [#45 — Autonomous Team Creation](https://github.com/robert-gleis/issueflow/issues/45)
**Parent:** #16 — Epic: Autonomous Execution
**Builds on:** #34 (Team Planner), #41 (Team Lifecycle Manager), #33 (Agent Adapter Interface), #23 (Agent Event Log), ADR-0002
**Status:** Approved

## Summary

Add a **policy layer** over the Team Planner that optionally skips the human `planned → approved` step. When `autonomous_mode` is enabled, `issueflow plan generate` auto-approves the planner output immediately after writing `team-plan.json` and transitioning to `planned`. The decision is recorded in the Event Log as a `team.planned` event referencing the team definition path. When `autonomous_mode` is false (default), behaviour is unchanged — human approval via `issueflow plan approve` remains required.

This ticket does **not** build a new planner. Team composition decisions stay in #34.

## Goals

- Extend configuration with `autonomous_mode: boolean` (default `false`).
- After successful `plan generate`, when autonomous mode is on, automatically transition `planned → approved` without human input.
- Preserve the human approval path when autonomous mode is off.
- Append a `team.planned` event to the Event Log on auto-approval with `teamPlanPath` in the payload.
- Keep policy logic testable outside Commander so a future engine runner can call it directly.

## Non-Goals

- **New planner logic.** Consumes existing `runTeamPlanner` / `readTeamPlan` from `src/planner/`.
- **Auto-approval on manual `plan edit`.** Editing a plan stays in `planned` until explicit approval (human or a subsequent generate — but generate requires `triaged`, so only `plan approve` applies after edit).
- **ADR records for autonomous decisions.** ADRs are human architecture decisions (ADR-0001). Auto-approval is machine telemetry in the Event Log only.
- **Emitting `plan.approved` on auto-approval.** Acceptance criteria specify `team.planned`; timeline builder already maps both event types to the `planned` step (#31).
- **Human `plan approve` event emission.** Out of scope; human approval path behaviour is unchanged except remaining available when autonomous mode is off.
- **Workflow engine policy wiring.** v1 triggers auto-approval from `plan generate` at the composition root (same explicit-CLI pattern as #34 and #41).
- **Per-workflow config overrides.** v1 supports global config plus per-repo override. Per-issue workflow config is a follow-up.

## Dependency Note

All blocking tickets are merged in this worktree:

- `src/planner/` — `runTeamPlanner`, `readTeamPlan`, schema validation
- `src/event-log/` — `EventLog.append`, `team.planned` event type
- `src/commands/plan.ts` — `plan generate` / `plan approve`
- `src/teams/` — consumes approved plans (downstream; not modified here)

## Considered Options

### A. Inline auto-approve in `plan.ts` generate handler (rejected)

Check config and call `writeState(planned → approved)` directly in the generate action.

**Pros:** Minimal files.
**Cons:** Mixes CLI wiring with policy; harder to test in isolation; blocks engine reuse.

### B. Policy module + composition-root hook (recommended)

`src/policy/autonomous-approval.ts` exports `maybeAutoApproveTeamPlan(input, deps)`. `plan generate` calls it after `triaged → planned`.

**Pros:** Testable, mirrors `src/planner/` / `src/teams/` separation, callable from future runner.
**Cons:** One more module.

### C. Workflow engine `tick` policy at `planned` state (rejected)

Engine observes `planned` and auto-transitions when config is set.

**Rejected:** Couples policy to engine state machine before CLI contract is proven; #34 explicitly deferred autonomous mode to this ticket with explicit `plan generate` as the trigger.

## Architecture

```
src/policy/
  types.ts                  # AutonomousApprovalInput/Result, AutonomousApprovalDeps
  config.ts                 # resolveAutonomousMode(repoRoot, deps) — global + repo merge
  autonomous-approval.ts    # maybeAutoApproveTeamPlan — gate, transition, event
  events.ts                 # buildTeamPlannedEvent(issueNumber, teamPlanPath)
  index.ts                  # barrel

src/config/
  types.ts                  # extend IssueflowConfig with autonomous_mode
  load.ts                   # parse autonomous_mode from YAML

src/commands/
  plan.ts                   # call maybeAutoApproveTeamPlan after generate transition
```

### Configuration

```yaml
# ~/.issueflow/config.yaml (global default)
autonomous_mode: false

# <repo>/.issueflow/config.yaml (optional per-repo override)
autonomous_mode: true
```

Resolution order (repo wins):

1. Parse `autonomous_mode` from `<repoRoot>/.issueflow/config.yaml` if the file exists.
2. Else parse from `~/.issueflow/config.yaml` (or `ISSUEFLOW_CONFIG` path).
3. Default `false` when absent or file missing.

`autonomous_mode` accepts YAML booleans (`true` / `false`). Invalid values throw at config load time with a path-qualified error message.

Extend `IssueflowConfig`:

```ts
export interface IssueflowConfig {
  watcher: WatcherConfig;
  autonomous_mode: boolean;
}

export const DEFAULT_CONFIG: IssueflowConfig = {
  watcher: DEFAULT_WATCHER_CONFIG,
  autonomous_mode: false
};
```

`loadConfig` continues to return defaults when the global config file is missing. `resolveAutonomousMode(repoRoot)` is a separate helper used by the policy module so per-repo overrides do not require changing the watcher-only `loadConfig` call sites.

### Auto-approval flow

Triggered only from `plan generate` after these steps succeed:

1. Planner output validated and written to `team-plan.json`.
2. `writeState(repo, issue, 'triaged', 'planned')` completes.

Then `maybeAutoApproveTeamPlan`:

1. `resolveAutonomousMode(repoRoot)` — if `false`, return `{ status: 'skipped' }` immediately (no event, no state change).
2. `readTeamPlan(worktreePath)` — re-validate schema (defensive; generate just wrote it).
3. `writeState(repo, issue, 'planned', 'approved')`.
4. `eventLog.append(buildTeamPlannedEvent(issueNumber, teamPlanPath))`.
5. Return `{ status: 'approved', teamPlanPath }`.

On failure at steps 2–4: print stderr with the underlying error, exit `1`, leave issue at `planned` (plan file exists; human can `plan approve` manually). Do **not** roll back `triaged → planned`.

### Event payload

```ts
// src/policy/events.ts
export function buildTeamPlannedEvent(
  issueNumber: number,
  teamPlanPath: string
): AppendEventInput {
  return {
    eventType: 'team.planned',
    issueId: issueNumber,
    payload: {
      teamPlanPath,
      autonomous: true
    }
  };
}
```

`agent_id` and `workflow_id` are omitted (nullable per #23). `autonomous: true` distinguishes auto-approval from any future `team.planned` writers.

### CLI surface changes

`plan generate` stdout when autonomous mode is on:

```
team plan written: <path>
planned -> approved (autonomous)
```

When autonomous mode is off (unchanged):

```
team plan written: <path>
```

`plan approve` is unchanged. Human approval remains available when autonomous mode is off. When autonomous mode is on, generate already transitions to `approved`; `plan approve` fails with the existing state guard (`must be in state "planned"`).

### Engine gate

Auto-approval inherits the generate command's `ISSUEFLOW_ENGINE=1` gate. No separate gate.

## Error Handling

| Error | When | Behaviour |
|-------|------|-----------|
| Config parse error | invalid `autonomous_mode` value | throw at `resolveAutonomousMode`; generate exits `1` |
| `TeamPlanValidationError` | plan unreadable during auto-approve | stderr, exit `1`, state stays `planned` |
| `InvalidTransitionError` | state not `planned` at auto-approve | stderr, exit `1`, state stays `planned` |
| Event log append failure | SQLite error | stderr, exit `1`, state stays `approved` (transition already committed; log failure is surfaced, not rolled back) |

Event log failure after a successful state transition is a known v1 trade-off (same pattern as team lifecycle events in #41). Operators can inspect GitHub labels; re-running approve is idempotently blocked at `approved`.

## Testing

Unit tests under `tests/unit/`:

- `policy-config.test.ts` — global default, repo override, missing files, invalid boolean
- `policy-events.test.ts` — `buildTeamPlannedEvent` shape
- `autonomous-approval.test.ts` — skipped when off, full path when on, failure leaves `planned`, event appended
- `config-load.test.ts` — extend existing tests for `autonomous_mode` in global YAML
- `plan-command.test.ts` — generate with autonomous on/off: stdout lines, `writeState` call count, `appendEvent` invoked

Inject deps: `resolveAutonomousMode`, `readTeamPlan`, `writeState`, `appendEvent`. No network or real SQLite in command tests (fake append callback).

## Acceptance Criteria Mapping

| Issue criterion | How this design satisfies it |
|-----------------|------------------------------|
| `autonomous_mode: true` auto-transitions `planned → approved` after planner output | `maybeAutoApproveTeamPlan` called at end of `plan generate` |
| `autonomous_mode: false` requires human `plan approve` | Policy returns `skipped`; approve command unchanged |
| Auto-approval recorded as `team.planned` with team definition path | `buildTeamPlannedEvent` payload includes `teamPlanPath` |
| Decisions not recorded as ADRs | No ADR writer; Event Log only |

## Risks

- **Partial failure after `planned`.** If auto-approve fails, issue sits at `planned` with a valid plan — recoverable via manual approve.
- **Config drift.** Repo override may surprise operators who only set global config. Document in spec; future `issueflow config show` can surface effective values.
- **Event vs state ordering.** State label is authoritative for workflow; event log is best-effort telemetry on append failure.

## Recommendation

Ship the policy module (option B) with global + per-repo config, hook from `plan generate`, and `team.planned` event emission. Minimal surface area, satisfies all acceptance criteria, and leaves a clean injection point for engine automation later.
