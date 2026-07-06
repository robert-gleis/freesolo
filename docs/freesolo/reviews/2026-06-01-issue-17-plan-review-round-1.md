# Plan Review — Issue #17 — Round 1

**Status:** pass_with_findings

## Summary
The plan is well-structured, the modules match the spec, and the import paths line up with the actual codebase (`parseGitHubRemote`/`readOriginRemote`/`resolveRepoRoot` really are exported from `src/core/git.ts`). However, the plan has a couple of test-correctness bugs around `setExitCode` semantics and a real risk that the `gh issue edit` "missing label" detection won't match the actual `gh` error string, plus a missing test for the spec's "state get is always allowed" requirement.

## Findings

### Finding 1: `state get` success-path test does not assert what the spec requires
**Severity:** major
**Location:** Plan Task 3, Step 1 — `tests/unit/state-command.test.ts` test `'prints the current state when one exists'`
**Problem:** The harness defaults `env: { FREESOLO_ENGINE: '1' }`. The happy-path `state get` test therefore runs with the engine variable already set, so it cannot prove that `state get` is "always allowed" (i.e., works even when `FREESOLO_ENGINE` is unset). The spec at lines 99–102 explicitly distinguishes `get` (always allowed) from `transition` (gated), but no test exercises `state get` without `FREESOLO_ENGINE`.
**Why it matters:** A future refactor that accidentally adds the gate to `get` would not be caught. The acceptance criterion "agents cannot bypass states" only constrains writes; if `get` becomes gated, read-only inspection by agents breaks silently.
**Suggested fix:** Add a test `it('does not require FREESOLO_ENGINE for state get', ...)` that builds the harness with `env: {}` and asserts `state get` still prints the current state and does not set exit code 3.

### Finding 2: `withCommanderErrorHandling` re-sets exit code 1 after a clean `setExitCode(2)` on a thrown null
**Severity:** minor
**Location:** Plan Task 3, Step 3 — `state get` action body inside `withCommanderErrorHandling`
**Problem:** When `readState` returns `null`, the action calls `deps.setExitCode(2)` and returns normally — `withCommanderErrorHandling` does not run because the inner promise resolves. Good. **But** the failing path `state get` with a `null` state never exercises a thrown error path that could overwrite the exit code. Conversely, the "happy path" test asserts `io.exitCode` is `null`. The implementation only calls `setExitCode` when state is null, so the happy path leaves `io.exitCode` at `null`. This is fine — flagging only because the test name "exits 2" plus an absence of "does not set exit code in happy path" leaves the code-coverage gap noted in Finding 1.
**Why it matters:** Not a bug per se, but combined with Finding 1, the test surface is thin on `state get`.
**Suggested fix:** Already covered by Finding 1's added test. No additional change needed if Finding 1 is addressed.

### Finding 3: Missing-label detection regex is brittle against current `gh` CLI error strings
**Severity:** major
**Location:** Plan Task 2, Step 3 — `isMissingLabelError` in `src/workflow/state-store.ts`
**Problem:** The detector requires the stderr/stdout to contain BOTH the lower-cased label name AND the substring `'not found'`. The test fabricates `'could not add label: "state:planned" not found'` and passes, but the actual `gh issue edit --add-label` error for a missing label varies across `gh` versions and has historically been formatted differently — e.g., `'state:planned' not found` (single quotes), or in newer versions a GraphQL-wrapped message such as `Could not resolve to a node with the global id of 'LA_...'` for label IDs that no longer exist, or `failed to update https://...: 'state:planned' not found`. None of those are guaranteed to contain `'state:planned'` AND `'not found'` as separate substrings in the lower-cased combined string.
**Why it matters:** If the real `gh` error doesn't match the detector, `writeState` throws a generic "Failed to swap state labels" error and never creates the missing label — defeating the "creates labels on demand" path described in the spec at lines 66–67 and 90.
**Suggested fix:** Either (a) call `ensureStateLabels(repo)` (or a per-state variant) up-front on every `writeState` invocation rather than relying on error-string sniffing, OR (b) make the detector more permissive (e.g., match `not found` OR `does not exist` OR `could not find`, and don't require the exact label name to appear). The spec already describes `ensureStateLabels` as a one-shot bootstrap, so a more reliable design is: `writeState` calls `createStateLabel(repo, to, gh)` (which uses `--force`, so it's a no-op when present) BEFORE the `issue edit`, eliminating the error-sniff branch entirely. The test for "creates the missing target label and retries" would need to be replaced with one that asserts the create-then-edit ordering on every write.

### Finding 4: `readState` exit-code is not surfaced from `MultipleStateLabelsError` when raised by `state transition`
**Severity:** minor
**Location:** Plan Task 3, Step 3 — transition action's outer `withCommanderErrorHandling` vs. the no-current-state branch
**Problem:** In the `transition` action, if `readState` rejects with `MultipleStateLabelsError`, the error flows out of the inner async block and is caught by `withCommanderErrorHandling`, which correctly sets exit code 4. Good. But there's no test exercising `MultipleStateLabelsError` from `state transition` — only `state get` is covered (`'reports a malformed state and exits 4'`). The spec at line 115 says the CLI uses exit code 4 for malformed state "wherever `writeState` is called"; `state transition` is the primary writer and lacks coverage.
**Why it matters:** A regression in the transition action's error pipeline (e.g., catching `MultipleStateLabelsError` and downgrading it to exit 1) would not be caught.
**Suggested fix:** Add `it('exits 4 when readState sees multiple state labels during transition', ...)` mirroring the `state get` test but for the transition path.

### Finding 5: Verification step assumes `state get --issue 17` against the live repo exits with code 2, but issue #17 may have its own labels by then
**Severity:** minor
**Location:** Plan "Verification Pass" section — `node ./dist/src/bin.js state get --issue 17`
**Problem:** The verification claim is "exit code 2 expected because no labels are seeded yet". But issue #17 in this repo could acquire a `state:*` label during testing (e.g., if the implementer manually runs `state transition` during development, or if `ensureStateLabels` is run and a manual label is added). More importantly, this step requires network access and live `gh` auth, which makes the verification non-deterministic.
**Why it matters:** A flaky final verification step makes "done" ambiguous.
**Suggested fix:** Change the live-binary smoke test to use an issue number that is guaranteed not to exist (e.g., `--issue 999999`) and assert any deterministic exit code (the read will fail), OR drop the live-`gh` step and rely solely on `npm test` + `npm run build`. The acceptance-criteria mapping below already covers behavior via unit tests.

### Finding 6: Plan does not update `docs/freesolo/specs/...` mapping when `MultipleStateLabelsError` constructor receives `string[]` literal
**Severity:** minor
**Location:** Plan Task 3, Step 1 — test `'reports a malformed state and exits 4'` and Task 2, Step 3 — `MultipleStateLabelsError` constructor
**Problem:** The test calls `new MultipleStateLabelsError(17, ['triaged', 'planned'])`. The constructor signature is `constructor(issueNumber: number, labels: WorkflowState[])`. Under strict TypeScript, contextual typing typically narrows the literal `'triaged'` to the `WorkflowState` union, so this should compile — but only because every literal in that array IS a valid `WorkflowState`. If a future test passes `['triaged', 'foo']`, the test will fail at the TypeScript layer with a confusing message rather than at runtime. Not a current bug, but worth being explicit.
**Why it matters:** Maintainability — future contributors may not notice the contextual narrowing and add invalid labels.
**Suggested fix:** Either widen `labels: WorkflowState[]` to `labels: string[]` on the error class (since the whole point of this error is "we got labels we didn't expect"), or assert in the test with `as WorkflowState[]`.

### Finding 7: `gh issue edit` requires `--repo` placement; plan places it after the issue number, which is fine, but the error message in `readState` is unhelpful when `gh` is missing auth or `gh` is not installed
**Severity:** minor
**Location:** Plan Task 2, Step 3 — `readState` error path: `throw new Error('Failed to read labels for issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}')`
**Problem:** When `gh` is not installed, `execa('gh', ...)` rejects with `ENOENT` BEFORE the runner returns a `GhResult`. The plan's `defaultRunner` calls `execa('gh', args, { reject: false })` — but `reject: false` only suppresses non-zero exit codes; it does NOT suppress spawn errors. If `gh` is missing from PATH, `execa` still throws, and the error propagates as a raw `ENOENT` rather than the user-friendly message that `src/core/github.ts` provides for `listAssignedIssues` ("freesolo requires GitHub CLI access. Run `gh auth status` and retry.").
**Why it matters:** Inconsistent failure UX between `state` commands and the existing `start` command.
**Suggested fix:** Wrap the `execa` call in `defaultRunner` with a try/catch that maps `ENOENT` to a clear "GitHub CLI not installed" message, mirroring `listAssignedIssues`. Optionally add a test that injects a runner whose call rejects to confirm the error message bubbles cleanly.

### Finding 8: Plan re-creates `RepoRef` instead of reusing the existing `RepoContext`, doubling the domain types
**Severity:** minor
**Location:** Plan Task 2, Step 3 — `export interface RepoRef { owner: string; repo: string }` in `src/workflow/state-store.ts`
**Problem:** The codebase already exports `RepoContext` from `src/core/types.ts` with fields `{ host, owner, repo, remoteUrl, rootDir }`. The plan invents a separate `RepoRef` with just `{ owner, repo }`. The two will need conversion at every boundary; `defaultResolveRepoRef` strips the extra fields. This is a maintainability concern — two repo-identifier types in one codebase.
**Why it matters:** Future code that touches both `start` and `state` commands has to reconcile them. The acceptance criteria don't forbid using `RepoContext` directly.
**Suggested fix:** Either (a) reuse `RepoContext` in `state-store.ts` and let consumers ignore `host`/`remoteUrl`/`rootDir`, or (b) export `RepoRef = Pick<RepoContext, 'owner' | 'repo'>` from `core/types.ts` so there is one canonical type and one alias.

## Verified OK
- `parseGitHubRemote`, `readOriginRemote`, and `resolveRepoRoot` are all exported from `src/core/git.ts` exactly as the plan imports them (verified in `src/core/git.ts:5,31,40`).
- ESM `.js` extension convention in imports matches the existing codebase (`src/commands/start.ts:7-8` uses the same pattern).
- `gh issue edit --add-label X --remove-label Y` in a single invocation is supported (`gh issue edit --help` example shows it explicitly).
- `gh label create --force` is idempotent for both create and update (`gh label create --help` description confirms it).
- `package.json` scripts: `npm test` runs `vitest run` and `npm run build` runs `tsc -p tsconfig.json` + ensure-bin-executable — both used correctly in the plan.
- `tsconfig.json` has `rootDir: "."` and `include: ["src/**/*.ts"]`, so adding `src/workflow/state-machine.ts`, `src/workflow/state-store.ts`, `src/commands/state.ts` is picked up automatically.
- The state set, transition table, error message format, and exit codes (1/2/3/4) match the spec exactly.
- `WORKFLOW_STATES` is `as const` and `WorkflowState` is derived from it — satisfies the spec's "one declaration to add a state" requirement.
- The `state-machine.ts` test drives `TRANSITIONS` as the source of truth, satisfying the spec's "test grows automatically when a state is added" requirement.
- Commander's `program.exitOverride()` cascades to subcommands in Commander 14, so the test harness on the root program is sufficient.
- `parseAsync` correctly awaits async action handlers, so the tests' `await program.parseAsync(...)` pattern works.
- `vi.mocked` / `vi.fn().mockResolvedValue` / `vi.fn().mockRejectedValue` patterns match the existing `tests/unit/github.test.ts` style.
- The CLI registration test pattern (`program.commands.find((c) => c.name() === 'state')`) matches the existing `cli.test.ts` pattern.
- README has an existing `## Usage` section that the plan correctly appends to (verified by file structure).
