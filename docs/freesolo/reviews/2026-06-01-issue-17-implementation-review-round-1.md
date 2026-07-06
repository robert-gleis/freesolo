# Implementation Review — Issue #17 — Round 1

**Status:** pass_with_findings

## Summary
The implementation closely follows the plan and spec. `state-machine.ts`, `state-store.ts`, and `commands/state.ts` are well-factored, dependency-injected for tests, and every transition/error path is exercised. `npm test` (113 tests across 18 files) and `npm run build` both succeed cleanly. Two minor findings are noted: an unguarded `JSON.parse` on `gh` stdout, and silent swallowing of unrecognised `state:*` labels that the spec implies should be surfaced as malformed state.

## Acceptance criteria check
- **AC1 — State stored in GitHub issue labels:** met. `state-store.ts` reads/writes `state:<name>` labels via `gh issue view --json labels` and `gh issue edit --remove-label/--add-label`.
- **AC2 — Transitions explicit and enumerable:** met. `WORKFLOW_STATES` and `TRANSITIONS` are exported `const`s; tests enumerate every allowed pair.
- **AC3 — Agents cannot bypass states:** met (as a soft gate). `state transition` requires `FREESOLO_ENGINE=1`; absent the variable, exit 3 is returned with a clear message and `writeState` is never called. State writes are only exposed through the CLI.
- **AC4 — Invalid transitions rejected with a clear error:** met. `InvalidTransitionError` carries `from`, `to`, `allowedNext`, and renders the exact message `"Invalid workflow transition: <from> → <to>. Allowed from <from>: <list-or-(terminal)>."`. CLI surfaces exit code 1.
- **AC5 — State recoverable after restart:** met. State lives on GitHub; `readState` is stateless and pure I/O.

## Findings

### Finding 1: Unrecognised `state:*` labels are silently dropped instead of surfaced as malformed
**Severity:** minor
**Location:** `/Users/A15AB98/projects/private/freesolo.issue-17-introduce-workflow-state-machine/src/workflow/state-store.ts:63-71` (`parseState`) and `:108-110` (filter in `readState`)
**Problem:** `parseState` returns `null` for any label that starts with `state:` but does not match one of the nine canonical states (e.g. `state:bogus`, `state:`, `state:in-review`). The filter at line 110 then strips those nulls. The result: an issue carrying only a single bogus `state:foo` label is reported by `readState` as `null` — exactly the same signal used for "uninitialised issue". Two operationally distinct conditions (no state vs. a corrupt/mislabelled state) collapse to the same return value.
**Why it matters:** The spec's storage section says the read path tolerates "no `state:*` label" and "multiple `state:*` labels"; the natural third bucket — a `state:*` label whose suffix is not a known state — should also be surfaced so an operator can fix it before transitions resume. As implemented, an operator who fat-fingers `state:planed` (typo) and then runs `freesolo state transition --to planned` will see the "Issue #N has no current workflow state" message and be told to initialise the issue, masking the typo.
**Suggested fix:** Detect labels with the `state:` prefix whose suffix is not in `WORKFLOW_STATES` and either (a) extend `MultipleStateLabelsError` into an `InvalidStateLabelError` that names the offending label, or (b) include those labels in the existing multi-label error path. Either way, surface them rather than silently filtering them out.

### Finding 2: `JSON.parse` of `gh` stdout is unguarded
**Severity:** minor
**Location:** `/Users/A15AB98/projects/private/freesolo.issue-17-introduce-workflow-state-machine/src/workflow/state-store.ts:107`
**Problem:** `const payload = JSON.parse(result.stdout || '{}') as IssueLabelsResponse;` is called directly. If `gh` exits 0 but emits non-JSON (interactive auth prompt, future format change, a wrapper like `gh-dash` standing in for `gh`, a corporate SSO interstitial that intercepts stdout, etc.), a `SyntaxError` propagates with no context. The CLI then prints `"Unexpected token ... in JSON at position N"` to stderr and exits 1 — useless for an operator trying to diagnose what `gh` actually returned.
**Why it matters:** The friendly diagnostic effort in `defaultRunner` (the "freesolo requires GitHub CLI access. Run `gh auth status` and retry." message) is wasted if a happy-exit-with-garbage-stdout case slips past it. Hardening this is cheap and prevents a confusing failure mode.
**Suggested fix:** Wrap the parse in a try/catch and throw `new Error(\`Failed to parse \`gh issue view\` output for issue #\${issueNumber}: \${err.message}\`)` (optionally truncating `result.stdout` into the message for debuggability). Also tighten the type guard — `payload.labels` is typed as optional/loose, but `payload` itself is asserted via `as` without runtime checks.

## Verified OK
- The nine canonical states appear in the exact order specified, and `WORKFLOW_STATES` is the single source of truth (`tests/unit/state-machine.test.ts:14-25` pins the order).
- `TRANSITIONS` matches the spec table cell-for-cell, including the realistic backward edges (`planned↔triaged`, `approved↔planned`, `implementing↔approved`, `reviewing↔implementing`, `verifying↔implementing`, `pr-ready↔implementing`) and the terminal `closed` (`src/workflow/state-machine.ts:15-25`).
- `canTransition`/`assertTransition` treat self-transitions as no-op-allowed for every state, including `closed` (verified via the "every self-transition" test loop).
- `InvalidTransitionError` message format matches the spec exactly, including the `(terminal)` rendering when `allowedNext` is empty.
- `writeState` calls `assertTransition` before any `gh` invocation and short-circuits the self-transition path before touching the network (`state-store.test.ts` asserts `calls.length === 0` in both rejected and self-transition cases).
- The label create uses `--force`, which per `gh label create --help` is the documented idempotent create-or-update flag.
- `defaultRunner` correctly distinguishes spawn failure (`exitCode === undefined` → friendly install hint) from non-zero exit (`exitCode` numeric → returned as `GhResult`). The unit tests cover both branches with realistic execa 9 error shapes.
- `state get` is exempt from the `FREESOLO_ENGINE` gate; only `state transition` enforces it. Exit codes line up with the spec: `0` happy path, `1` invalid transition or unknown `--to`, `2` no state label, `3` engine gate violation, `4` multiple state labels. Each is asserted by `state-command.test.ts`.
- The engine gate runs before `--to` validation, before `resolveRepoRef`, and before any `readState` call (`state-command.test.ts:97-115` proves `readState` and `writeState` are never called when the gate denies).
- `MultipleStateLabelsError` exit code (4) is wired through both `state get` and `state transition` via `withCommanderErrorHandling` (proven by `state-command.test.ts:208-228`).
- `cli.ts` registers `start` and the `state` group; `tests/unit/cli.test.ts` asserts both `get` and `transition` subcommands are discoverable on the parsed program.
- `README.md` documents the new commands, the exit-2 semantics, the env-var gate, and the canonical state list.
- `RepoRef` is centralised in `src/core/types.ts` and re-exported from `state-store.ts` — no duplicate repo-identifier types in the new modules.
- `npm test` → 113/113 pass across 18 files (1.46s).
- `npm run build` → clean `tsc` build; emitted `dist/src/workflow/state-machine.js`, `dist/src/workflow/state-store.js`, `dist/src/commands/state.js`.
- No new external runtime dependencies introduced; only `execa` and `commander`, already in the package.
