# Issue Status List Design

## Summary

`issueflow start` should keep showing only open issues assigned to the current user, but the interactive overview should also expose each issue's GitHub Project `Status` field so the list is easier to scan and prioritize.

The change should stay repo-centric: open issues still come from the current repository, and project metadata is only used to enrich the visible list with status information and a stable status-first ordering.

## Goals

- Keep the current scope of the picker to open issues assigned to the authenticated user in the current repository.
- Show a readable project status for each issue in the interactive selection list.
- Sort the issue overview by status before title or number so similar work states are grouped together.
- Handle issues that are not attached to a project or do not have a `Status` field value yet.
- Keep the data model ready for future status filtering without requiring another refactor of the issue-loading path.

## Non-Goals

- No change to the existing open-only issue scope.
- No requirement to read issues from a specific GitHub Project instead of the repository issue list.
- No CLI flag for status filtering in this change.
- No support for mutating project status values.

## Product Shape

When the user runs:

```bash
issueflow start --tool codex
```

the CLI should:

1. Resolve the current repository as today.
2. Load open issues assigned to the current user in that repository.
3. Enrich each issue with its GitHub Project `Status` field when available.
4. Sort the resulting list by status group.
5. Render the interactive picker so each row includes the status label ahead of the issue number and title.

Example display shape:

```text
[In Progress] #42 Improve issue picker
[Todo] #57 Add print-only hints
[No Status] #61 Clean up docs
```

## Data Design

`IssueSummary` gains an optional `status` field.

Normalization rules:

- Use the GitHub Project field named `Status`.
- If multiple project items exist, prefer the first non-empty `Status` value returned by GitHub for the issue.
- If no project item exposes a `Status` value, store `null` and render `No Status`.

This keeps the issue model forward-compatible with a future filter step that can operate on a single normalized field.

## Data Acquisition

The issue list should continue to start from `gh issue list` for the current repository because that is already aligned with the current repo-scoped workflow and open-issue behavior.

The GitHub integration should request project item metadata together with the existing issue fields and extract the project `Status` value from those project items. The implementation may use the issue JSON payload or a follow-up GraphQL lookup, but the public contract of the core layer should remain "repo-scoped open assigned issues with optional status enrichment."

If GitHub does not return any project item status for an issue, the CLI must still include the issue in the list instead of failing the command.

## Sorting Model

The default status order should prioritize active work first:

1. `In Progress`
2. `Todo`
3. `Done`
4. Any other non-empty status, sorted alphabetically after the known groups
5. `No Status`

Within the same status group, sort by issue number ascending so the order is stable and predictable.

This ordering is intentionally explicit instead of purely alphabetical because it matches the user's stated need to distinguish ongoing work from already finished work at a glance.

## UI Behavior

The picker text should remain concise and readable in a terminal prompt.

- Prefix each issue row with a bracketed status label.
- Use `No Status` for missing values rather than leaving a blank prefix.
- Keep the selection value unchanged: choosing an issue still returns the full `IssueSummary`.

## Error Handling

- If GitHub CLI access fails, keep the existing authentication error behavior.
- If status enrichment is partially unavailable, degrade gracefully by using `No Status`.
- If an issue is associated with multiple projects that expose different statuses, use the first non-empty value and avoid blocking the user with an ambiguity prompt in this version.

## Testing

Add tests that cover:

- normalization of status from GitHub issue data
- fallback to `null` when no project status exists
- status-first sorting behavior
- picker row formatting with visible status labels

## Follow-Up Hooks

This design should leave a natural extension point for a future filter such as `--status` or `--exclude-status`, but that filter is not part of this change.
