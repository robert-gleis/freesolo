# Implementation Review — Issue #17 — Round 2

**Status:** pass

## Summary
Both round-1 minor findings are addressed correctly with corresponding tests. The state machine domain module, the gh-backed store, the CLI surface, and the CLI wiring all line up with the spec. `npm test` is 117/117 green across 18 files and `npm run build` produces a clean `tsc` build with no diagnostics. No new defects worth flagging.

## Round 1 follow-up
- **Finding 1 (`state:*` labels with unknown suffix silently dropped):** fixed correctly. `InvalidStateLabelError` is defined in `src/workflow/state-store.ts:87-99`, raised eagerly by `readState` (`state-store.ts:130-138`) before the "no state" / "multi state" branches so it cannot be masked by `null` or `MultipleStateLabelsError`. The CLI maps it to exit 4 via `withCommanderErrorHandling` (`src/commands/state.ts:85-88`). New tests in `tests/unit/state-store.test.ts:88-104` cover both the bogus-only and bogus-plus-valid cases; `tests/unit/state-command.test.ts:95-105` covers the CLI exit-code mapping.
- **Finding 2 (unguarded `JSON.parse`):** fixed correctly. `src/workflow/state-store.ts:121-127` wraps the parse in try/catch and surfaces `Failed to parse \`gh issue view\` output for issue #<n>: <reason>`. `tests/unit/state-store.test.ts:106-110` proves the wrapper via a `not json` stdout fixture.

## Acceptance criteria check
- **AC1 — State stored in GitHub issue labels:** met. `state-store.ts` reads via `gh issue view --json labels` and writes via `gh issue edit --remove-label/--add-label` using the `state:` prefix.
- **AC2 — Transitions explicit and enumerable:** met. `WORKFLOW_STATES` and `TRANSITIONS` are exported `const`s; `tests/unit/state-machine.test.ts` enumerates every allowed pair and asserts the table is keyed by every state.
- **AC3 — Agents cannot bypass states:** met as a soft gate. `state transition` requires `ISSUEFLOW_ENGINE=1`; without it the command writes a clear stderr message and exits 3 before `readState`/`writeState` is touched (`state-command.test.ts:109-127`).
- **AC4 — Invalid transitions rejected with a clear error:** met. `InvalidTransitionError` carries `from`/`to`/`allowedNext`, message format is exactly the spec's `"Invalid workflow transition: <from> → <to>. Allowed from <from>: <list-or-(terminal)>."`, and CLI maps it to exit 1.
- **AC5 — State recoverable after restart:** met. State lives on GitHub labels; `readState` is stateless I/O with no local cache.

## Findings
No new findings.

## Verified OK
- `tsc -p tsconfig.json` builds cleanly and `dist/src/workflow/state-machine.js`, `dist/src/workflow/state-store.js`, `dist/src/commands/state.js` are emitted.
- 117/117 unit tests pass in ~3s across 18 files; new test counts: 23 (`state-machine.test.ts`), 12 (`state-store.test.ts`), 11 (`state-command.test.ts`).
- `InvalidStateLabelError` is checked before the "no labels" return path, so a single bogus `state:foo` label no longer collapses to the same signal as an uninitialised issue (round-1 Finding 1 actually addressed, not just papered over).
- `withCommanderErrorHandling` treats both `MultipleStateLabelsError` and `InvalidStateLabelError` as exit 4, matching the spec's "malformed state" bucket.
- `writeState` short-circuits on `from === to` and calls `assertTransition` before any `gh` invocation; `state-store.test.ts` asserts zero `gh` calls in both the rejected-transition and self-transition cases.
- `gh label create --force` is used for the up-front idempotent create-or-update, which avoids the brittle "sniff stderr for 'label not found'" approach the spec called out.
- `defaultRunner` still discriminates spawn failure (`exitCode === undefined`) from non-zero exit, with realistic execa-9-shaped fixtures covering both branches.
- `ISSUEFLOW_ENGINE` gate runs before `--to` validation, `resolveRepoRef`, and `readState` (`state-command.test.ts:109-127`).
- `state get` is exempt from the gate; `state-command.test.ts:59-70` proves it.
- `cli.ts` registers `start` and the `state` group; `cli.test.ts:29-36` confirms both `get` and `transition` subcommands are discoverable.
- `RepoRef` is centralised in `src/core/types.ts:50` and re-exported from `state-store.ts`; no duplicate repo-identifier types.
- README at `/Users/A15AB98/projects/private/issueflow.issue-17-introduce-workflow-state-machine/README.md:56-68` documents the new commands, exit-2 semantics, env-var gate, and canonical state list.
- No new runtime dependencies introduced.
