# Assigned Issue Intake with Local State - Design Spec

**Date**: 2026-06-15  
**Status**: draft

## Overview

Change the watcher from "find issues with an FreeSolo state label" to "find issues assigned to the current GitHub user, then let FreeSolo decide whether to take them into its local workflow".

GitHub remains the source for issue discovery and assignment. FreeSolo workflow state becomes local by default. A user should not need `state:*` labels in GitHub before `freesolo watch` can be useful.

## Product Behavior

Default watcher behavior:

1. Poll open GitHub issues assigned to the authenticated `gh` user.
2. For each issue with no local FreeSolo intake decision, ask whether FreeSolo should start it.
3. If accepted, initialize local workflow state to `triaged` and run one engine tick.
4. If rejected, record the issue as ignored locally so it is not prompted again on every poll.
5. For already accepted issues, continue draining them through the engine based on local workflow state.

This keeps the first-run experience conservative while still enabling automation after the user accepts an issue.

## Config

Resolved config keeps the existing global-then-repo layering:

```
DEFAULT_CONFIG -> global (~/.freesolo/config.yaml) -> repo (.freesolo/config.yaml)
```

New defaults:

| Key | Type | Valid Values | Default |
|-----|------|--------------|---------|
| `state_backend` | string | `local`, `github-labels` | `local` |
| `watcher.interval_seconds` | integer | >= 5 | `60` |
| `watcher.source` | string | `assigned-to-me`, `label` | `assigned-to-me` |
| `watcher.intake_mode` | string | `confirm`, `auto` | `confirm` |
| `watcher.initial_state` | string | any workflow state except terminal `closed` | `triaged` |
| `watcher.trigger_label` | string | non-empty | `triaged` |
| `autonomous_mode` | boolean | `true`, `false` | `false` |

Example default template:

```yaml
# Where workflow state is persisted.
#   local (default) - stores state in ~/.freesolo/state/<owner>/<repo>/<issue-number>
#   github-labels - writes a state:* label to the GitHub issue on every transition.
state_backend: local

# Autonomous watcher defaults (used by `freesolo watch`).
watcher:
  interval_seconds: 60
  source: assigned-to-me
  intake_mode: confirm
  initial_state: triaged
  trigger_label: "triaged"

# Set to true to allow the engine to auto-approve team plans without
# a human review gate.
autonomous_mode: false
```

`watcher.trigger_label` is only used when `watcher.source: label`, or when passed explicitly via `--trigger-label`.

## CLI Behavior

### `freesolo watch run`

Default command:

```bash
FREESOLO_ENGINE=1 freesolo watch run
```

With default config, this polls assigned open issues and prompts for new ones:

```text
Start issue #27 "Docker Runner (Future)"? [y/N]
```

Accepted issues are initialized locally and enqueued. Ignored issues are recorded locally and skipped in later cycles.

### `freesolo watch once`

`watch once` runs a single cycle with the same discovery and intake rules. In `confirm` mode, it may prompt. For non-interactive automation, users should set `watcher.intake_mode: auto` in config or pass `--intake-mode auto`.

### Overrides

Keep the existing interval override and add source/intake overrides:

```bash
freesolo watch run --interval 30
freesolo watch run --source assigned-to-me
freesolo watch run --source label --trigger-label triaged
freesolo watch run --intake-mode auto
```

`--trigger-label` implies `--source label` only if `--source` is omitted.

## GitHub Queries

For the default source:

```bash
gh issue list --repo <owner>/<repo> --state open --assignee @me --json number,title,updatedAt,labels,assignees --limit 100
```

For label source:

```bash
gh issue list --repo <owner>/<repo> --state open --search "updated:><cursor> label:<trigger_label>" --json number,title,updatedAt,labels,assignees --limit 100
```

The poll result should include enough issue metadata for the intake prompt and for deterministic tests.

## Local State Initialization

The current local state store supports reads and transitions, but `writeState()` cannot create a first state because transitions require an existing `from` state. Add a focused initialization API:

```ts
initializeState(repo, issueNumber, initialState): Promise<void>
```

Rules:

- Creates the local state file if none exists.
- Fails if the issue already has local state.
- Rejects terminal initial state `closed`.
- Does not write GitHub labels.

When `state_backend: github-labels`, initialization may create and apply `state:<initial_state>` as a compatibility path, but that is not the default.

## Intake Persistence

Add local watcher intake persistence to SQLite so prompt decisions survive restarts.

New table:

```sql
CREATE TABLE IF NOT EXISTS watcher_intake (
  repo_owner TEXT NOT NULL,
  repo_name TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accepted', 'ignored')),
  decided_at TEXT NOT NULL,
  issue_updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_owner, repo_name, issue_number)
);
```

Behavior:

- Missing row means "not seen by intake yet".
- `accepted` means the watcher may enqueue/drain the issue.
- `ignored` means the watcher skips it until the user explicitly clears the decision in a future command.
- If an accepted issue has no local state because the user deleted local files, the watcher reports a clear error rather than silently reinitializing.

## Runner Flow

Each watch cycle:

1. Recover stale queue rows.
2. Poll issues from the configured source.
3. For each polled issue:
   - If already ignored, skip.
   - If already accepted, enqueue.
   - If unseen and `intake_mode: auto`, initialize state and mark accepted.
   - If unseen and `intake_mode: confirm`, prompt; accepted initializes state, rejected marks ignored.
4. Drain pending queue rows through `createWorkflowEngine().tick()`.
5. Advance cursor only after poll/intake/drain behavior is complete.

The engine should read local state by default because `state_backend` defaults to `local`.

## Backward Compatibility

- Existing configs with `state_backend: github-labels` continue to work.
- Existing configs with `watcher.trigger_label` continue to parse.
- Existing command `freesolo watch run --trigger-label state:triaged` still works and selects label-source behavior.
- Existing local state files remain valid.
- Existing watcher cursor and queue tables remain valid; a new migration adds `watcher_intake`.

## Error Handling

- If `gh issue list` cannot determine `@me` assignment because authentication is missing, surface the `gh` error directly with guidance to run `gh auth status`.
- If `confirm` mode is used without an interactive stdin, fail clearly and recommend `watcher.intake_mode: auto` for automation.
- If local state initialization fails because state already exists, mark the issue accepted and proceed only if the existing state is valid.
- If GitHub returns 100 issues, keep the existing pagination warning.

## Tests

Add or update tests for:

- Config parsing, defaults, origins, and template output for the new watcher keys.
- Poll query construction for `assigned-to-me` and label source.
- Intake store CRUD for accepted and ignored decisions.
- Runner behavior:
  - unseen assigned issue prompts and initializes local `triaged` on yes;
  - unseen assigned issue records ignored on no;
  - `auto` accepts without prompting;
  - ignored issue is not re-prompted;
  - accepted issue drains through engine using local state.
- CLI overrides for `--source`, `--intake-mode`, and `--trigger-label`.
- Backward compatibility for explicit `--trigger-label state:triaged`.

## Non-Goals

- No GitHub issue assignment mutation; FreeSolo only reads assignees.
- No automatic un-ignore command in this slice. Ignored rows can be managed later through a dedicated CLI.
- No full pagination beyond the existing `--limit 100` behavior.
- No removal of `github-labels`; it remains available for users who want GitHub-visible workflow state.
