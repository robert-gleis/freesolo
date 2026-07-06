# Workflow State Machine Design

**Issue:** [#17 — Introduce Workflow State Machine](https://github.com/robert-gleis/freesolo/issues/17)
**Parent:** #7 — Epic: Make FreeSolo the Factory Controller
**Status:** Draft, awaiting user review

## Goal

Give every FreeSolo-managed GitHub issue an explicit, persisted state that advances only through enumerated transitions. Establish the storage layer, the transition table, and the public API that a future workflow engine (separate ticket) will consume. Agent processes must be able to read state but must not be able to mutate it.

## Non-goals

- Building the workflow engine itself. The engine that calls these transitions is a separate ticket (parent epic mentions "Create Workflow Engine").
- Replacing the existing `currentStage` field in `session.json`. That field describes intra-session sub-stages used by an agent during a single working session and stays unchanged.
- Cross-issue scheduling, queueing, or priority logic.
- Migrating existing open issues. The state machine applies to issues opened or first-touched after this lands; backfilling is out of scope.

## The State Set

Exactly the nine states named in the issue, in canonical order:

```
triaged → planned → approved → implementing → reviewing → verifying → pr-ready → merged → closed
```

- **`triaged`** — issue accepted into the queue; ready for spec/planning work to begin.
- **`planned`** — spec and/or plan artifacts exist for the issue.
- **`approved`** — user reviewed the plan and authorised implementation.
- **`implementing`** — code work in progress on a worktree branch.
- **`reviewing`** — implementation review/fix loop running.
- **`verifying`** — final verification pass (tests, lint, build) running.
- **`pr-ready`** — branch is verified and ready to open a PR.
- **`merged`** — PR has been merged to the main branch.
- **`closed`** — issue closed on GitHub (terminal).

## Transition Table

Forward transitions follow the canonical pipeline. A small set of explicit backward transitions covers realistic recovery paths.

| From            | Allowed `to`                          |
|-----------------|---------------------------------------|
| `triaged`       | `planned`                             |
| `planned`       | `approved`, `triaged`                 |
| `approved`      | `implementing`, `planned`             |
| `implementing`  | `reviewing`, `approved`               |
| `reviewing`     | `verifying`, `implementing`           |
| `verifying`     | `pr-ready`, `implementing`            |
| `pr-ready`      | `merged`, `implementing`              |
| `merged`        | `closed`                              |
| `closed`        | (terminal — no outgoing transitions)  |

Notes:
- Idempotent self-transitions (`from === to`) are accepted as no-ops. They do not raise an error so a duplicate trigger from an engine or hook is harmless.
- Any pair not in the table is rejected with a structured `InvalidTransitionError` that names the source state, the target state, and the set of allowed next states from the source.
- The set of states and the table are exported as `const` and the union type is derived from them — adding a state requires touching exactly one declaration.

## Storage

State is persisted in GitHub issue labels using the prefix `state:`. At every observable moment, an issue handled by FreeSolo carries exactly one `state:*` label. The label name is the canonical state (`state:triaged`, `state:planned`, …, `state:closed`).

GitHub labels were chosen over comments or repo metadata because:
- They are the only issue-scoped artifact GitHub treats as a first-class enumerable field, addressable via `gh issue list --label`.
- They survive restarts trivially — reading state is a `gh` call, no local cache.
- They are visible in the GitHub UI without parsing, which gives operators a free dashboard.

Label management is the state machine's responsibility. The labels are created in the repo on demand the first time a write encounters a missing label (via `gh label create`). A bootstrap helper exists for one-shot creation across a fresh repo.

The write path uses a single `gh issue edit --remove-label state:<from> --add-label state:<to>` invocation. GitHub applies both label edits within one API call, so an external observer sees the swap atomically. The read path still tolerates a "no `state:*` label" case (uninitialised issue, returned as `null`) and a "multiple `state:*` labels" case (malformed state, surfaced via `MultipleStateLabelsError` so an operator can repair it before any further transition succeeds).

## Modules

The implementation lands in three new files plus a CLI command surface.

### `src/workflow/state-machine.ts`

Pure domain module, no I/O. Exports:

- `WORKFLOW_STATES` — readonly tuple of the nine state strings.
- `WorkflowState` — union type derived from the tuple.
- `TRANSITIONS` — readonly map keyed by source state, value is the readonly array of allowed targets. Self-transitions are not listed; the helper functions special-case them.
- `canTransition(from, to)` — boolean; true for valid transitions and for `from === to`.
- `assertTransition(from, to)` — throws `InvalidTransitionError` if `canTransition` is false; otherwise returns `void`.
- `InvalidTransitionError` — extends `Error`, exposes `.from`, `.to`, and `.allowedNext: WorkflowState[]`. Message format: `"Invalid workflow transition: ${from} → ${to}. Allowed from ${from}: ${allowedNext.join(', ') || '(terminal)'}."`

### `src/workflow/state-store.ts`

GitHub-backed I/O module. Exports:

- `readState(repo, issueNumber)` — returns `WorkflowState | null` (`null` when no `state:*` label is present). Throws `MultipleStateLabelsError` if more than one `state:*` label is set.
- `writeState(repo, issueNumber, from, to)` — calls `assertTransition(from, to)` first. If `from === to`, returns immediately. Otherwise removes the `state:from` label and adds the `state:to` label using `gh issue edit --remove-label ... --add-label ...` (this can be done in a single `gh` invocation, removing the atomicity concern between two calls). If the target label does not exist in the repo, the helper creates it before retrying.
- `ensureStateLabels(repo)` — bootstrap: creates any missing `state:*` labels with a consistent colour set so the GitHub UI is readable. Idempotent.

The module depends only on `execa` plus a small `runGh()` helper for testability — tests inject a fake `gh` runner.

### `src/commands/state.ts`

Two subcommands wired up under `freesolo state`:

- `freesolo state get --issue <number>` — read-only. Prints the current state to stdout, or prints `null` and exits with code `2` if the issue has no `state:*` label. Always allowed.
- `freesolo state transition --issue <number> --to <state>` — gated. Reads the current state, then calls `writeState`. **Requires `FREESOLO_ENGINE=1` in the environment** — without it the command prints a clear error and exits with code `3`. The error names the offending command and tells the caller that direct transitions from agent processes are not permitted; the engine sets this variable.

The gating is a soft enforcement aimed at agent prompts, not a security boundary. Any operator can set the env var; the goal is to make accidental writes from prompted agents impossible, which matches how the issue describes "no direct writes from agent processes."

### `src/cli.ts`

Register the new `state` command group alongside the existing `start` command.

## Errors

Two named error classes, both extending `Error`:

- `InvalidTransitionError` — raised by `assertTransition` and surfaced wherever `writeState` is called. Carries `from`, `to`, `allowedNext`.
- `MultipleStateLabelsError` — raised by `readState` when more than one `state:*` label is present. Carries `issueNumber` and `labels`.

Both errors render with a one-line, actionable message. The CLI translates them to non-zero exit codes (`1` for an invalid transition, `4` for malformed state) and prints the message to stderr.

## Recoverability

Because the state lives on GitHub labels, restart recovery is implicit: a fresh process calls `readState` and resumes. There is no local state file to drift, and no migration to run between restarts. A repo whose labels were not bootstrapped runs `ensureStateLabels` on first write; this is safe to run repeatedly.

## Testing

Unit tests use Vitest, following the project's existing patterns.

- `tests/unit/state-machine.test.ts` — covers `canTransition` for every (from, to) pair (both the allowed entries and a representative sample of rejected ones), self-transition idempotency, and the shape of `InvalidTransitionError`. Drives the transition table from the exported `TRANSITIONS` constant so the test grows automatically when a state is added.
- `tests/unit/state-store.test.ts` — covers `readState` for the no-label, single-label, and multi-label cases; covers `writeState` for the happy path, the rejected-transition path, the missing-target-label-then-create path, and the no-op self-transition; covers `ensureStateLabels` idempotency. All tests inject a fake `gh` runner so no network calls are made.
- `tests/unit/state-command.test.ts` — covers the `freesolo state get` and `freesolo state transition` CLI surface, including the `FREESOLO_ENGINE` gate and the exit codes.

No integration test against a real GitHub repo. The `gh` runner is mocked everywhere.

## Acceptance Criteria Mapping

| Criterion from issue                                                  | How this design satisfies it                                                                                                   |
|-----------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| State is stored in GitHub issue labels, comments, or metadata         | Labels under the `state:` prefix, one per issue.                                                                               |
| State transitions are explicit and enumerable                         | `TRANSITIONS` is a single exported `const` map; the test suite enumerates it.                                                  |
| Agents cannot bypass states (no direct writes from agent processes)   | The `transition` CLI requires `FREESOLO_ENGINE=1`; agent prompts never set it. State writes outside the CLI have no API.      |
| Invalid transitions are rejected with a clear error                   | `assertTransition` throws `InvalidTransitionError` with from/to and allowed-next; CLI prints it and exits non-zero.            |
| State is recoverable after restart                                    | State lives on GitHub; restart is implicit via `readState`. No local cache to lose.                                            |
