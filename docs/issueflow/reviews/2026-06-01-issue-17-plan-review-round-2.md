# Plan Review — Issue #17 — Round 2

**Status:** pass_with_findings

## Summary
The round-1 findings are all addressed in the right places: the create-then-edit ordering replaces the brittle error-string sniff, `RepoRef` is hoisted to `core/types.ts` as a `Pick`, the "state get is always allowed" test exists, the `MultipleStateLabelsError` path is covered for `state transition`, and the live-`gh` verification step is gone. One new defect was introduced while fixing round 1: the `defaultRunner` ENOENT handler is unreachable in production because `execa('gh', args, { reject: false })` is documented to surface spawn failures via the resolved result (with `failed: true`), not via a thrown error — the test passes only because the mock is set to `mockRejectedValueOnce`, which does not match real execa 9 behaviour with `reject: false`. Two minor consistency items also remain.

## Round 1 follow-up
- Finding 1 (state get always allowed test) — **fixed correctly.** New test at plan lines 707–718 builds the harness with `env: {}` and asserts `state get` still prints the state and does not set an exit code.
- Finding 2 (test-surface gap on state get) — **fixed correctly** by Finding 1's added test.
- Finding 3 (brittle missing-label regex) — **fixed correctly.** `writeState` now calls `createStateLabel(repo, to, gh)` upfront on every non-self transition, and the unit test asserts exactly two `gh` invocations in `label create` → `issue edit` order. The error-string sniff is gone, and the self-transition short-circuit still occurs before the label create so the "no-op for self-transitions" test legitimately expects zero `gh` calls.
- Finding 4 (no MultipleStateLabelsError coverage for transition) — **fixed correctly.** New test at plan lines 855–874 mocks `readState` to reject with `MultipleStateLabelsError` against the `transition` command and asserts exit code 4 and that `writeState` was never invoked.
- Finding 5 (flaky live-`gh` smoke test) — **fixed correctly.** The Verification Pass section now consists of `npm test` and `npm run build` only.
- Finding 6 (`MultipleStateLabelsError` accepting any string array) — **fixed correctly.** The constructor signature is now `labels: string[]` in both the implementation and the test instantiations.
- Finding 7 (friendly ENOENT mapping) — **fixed with new issue.** The handler exists, but the wrapper is unreachable in production (see Finding 1 below).
- Finding 8 (`RepoRef` duplication) — **fixed correctly.** `RepoRef = Pick<RepoContext, 'owner' | 'repo'>` is appended to `src/core/types.ts`; `state-store.ts` imports it from `core/types.js` and re-exports it; `commands/state.ts` imports the re-export. One canonical type.

## Findings

### Finding 1: `defaultRunner` ENOENT handler is unreachable in production with `reject: false`
**Severity:** major
**Location:** Plan Task 2, Step 3 — `src/workflow/state-store.ts` `defaultRunner` (plan lines 467–481); the matching test at plan lines 404–413.
**Problem:** The production code calls `execa('gh', args, { reject: false })` and wraps it in a `try/catch` that maps `code === 'ENOENT'` to the friendly "issueflow requires GitHub CLI access…" message. In execa 9, `reject: false` causes the returned promise to resolve (with `failed: true`, `exitCode: undefined`, an `error` property, etc.) for any kind of subprocess failure, including the spawn-time `ENOENT` case when `gh` is not on `PATH`. The wrapper's `catch` block therefore never runs in real use. The unit test passes only because it calls `vi.mocked(execa).mockRejectedValueOnce(enoent)` — the mock unilaterally rejects, contradicting how the production code instructs execa to behave. The "passes through non-zero exit codes without throwing" sibling test is also a mock-only behaviour.
**Why it matters:** The whole point of the round-1 fix was UX parity with `listAssignedIssues` (which does NOT pass `reject: false`, hence its `try { … } catch { throw new Error('issueflow requires GitHub CLI access…') }` works as advertised). With the current plan, running `issueflow state get` on a machine without `gh` will surface a raw "command failed" / undefined-exit-code error from `defaultRunner`'s downstream consumers (e.g. `readState`'s `Failed to read labels for issue #N: gh exited non-zero`), not the friendly install hint — and the test suite will be green so nothing catches it.
**Suggested fix:** Pick one of:
1. Drop `reject: false` (call `await execa('gh', args)`), wrap the whole call in `try/catch`, and use `result.exitCode ?? 1` when execa rejects with a `ExecaError` carrying an `exitCode`. Then the `ENOENT` mapping fires for real. The test would mock execa to reject for both the ENOENT case and the non-zero-exit case, mirroring real execa 9 behaviour.
2. Keep `reject: false`, but inspect the resolved result: if `result.failed === true && result.exitCode === undefined` (or check `result.errno`/`result.code === 'ENOENT'` on the result object), throw the friendly message. Update the test to use `mockResolvedValueOnce({ failed: true, exitCode: undefined, shortMessage: 'spawn gh ENOENT', code: 'ENOENT' } as never)` instead of `mockRejectedValueOnce`.

Option 1 is closer to the existing codebase convention (`src/core/github.ts:184` does this exact pattern). Either way the test must exercise the same call shape the production code uses.

### Finding 2: `vi.restoreAllMocks()` in `afterEach` does not restore the module-level `execa` mock state across tests
**Severity:** minor
**Location:** Plan Task 2, Step 1 — `tests/unit/state-store.test.ts` (no `beforeEach`/`afterEach`; only a single top-level `vi.mock`).
**Problem:** The `defaultRunner` tests at plan lines 403–426 each call `vi.mocked(execa).mockRejectedValueOnce(...)` / `.mockResolvedValueOnce(...)`. Because the tests share one `vi.fn()` instance (created at module init by `vi.mock('execa', () => ({ execa: vi.fn() }))`), any test that leaves queued return values would leak into later tests. There is no `beforeEach(() => mockedExeca.mockReset())` — unlike `tests/unit/github.test.ts` line 13–15 which explicitly resets. Currently the two `defaultRunner` tests each enqueue exactly one return and consume it, so the queue is balanced; but adding a third test that forgets to consume its `mockOnce` will silently affect the next test in source order.
**Why it matters:** Maintenance trap. The codebase's established `tests/unit/github.test.ts` pattern includes the reset; deviating from it for the new test invites flakey-on-add bugs.
**Suggested fix:** Add `beforeEach(() => { vi.mocked(execa).mockReset(); })` (or `mockClear()`) at the top of `tests/unit/state-store.test.ts`, matching the pattern in `tests/unit/github.test.ts`.

### Finding 3: `state get` action with `MultipleStateLabelsError` writes the error message but does not include "Issue #17" in the assertion — also nothing checks the stdout is silent
**Severity:** minor
**Location:** Plan Task 3, Step 1 — `tests/unit/state-command.test.ts` `'reports a malformed state and exits 4'` (plan lines 731–740) and the matching test for transition (plan lines 855–874).
**Problem:** The two `MultipleStateLabelsError` tests assert `io.stderr.join('')).toContain('multiple workflow state labels')`. But there is no assertion that `io.stdout` is empty. A regression where `state get` accidentally writes `'null\n'` (or any partial state) to stdout before bubbling the error would not be caught. Same for `transition`. Minor because the implementation does call `await deps.readState(...)` before any stdout write, so a rejected promise cannot leak partial output today — but the test contract is weaker than it should be.
**Why it matters:** Future refactors that move the print before the read would silently regress.
**Suggested fix:** Add `expect(io.stdout).toEqual([])` to both `MultipleStateLabelsError` tests so the stderr-only contract is locked in.

## Verified OK
- The transition table (plan lines 183–193) matches the spec table exactly: `triaged→planned`; `planned→approved|triaged`; `approved→implementing|planned`; `implementing→reviewing|approved`; `reviewing→verifying|implementing`; `verifying→pr-ready|implementing`; `pr-ready→merged|implementing`; `merged→closed`; `closed→[]`.
- `InvalidTransitionError` message format `"Invalid workflow transition: ${from} → ${to}. Allowed from ${from}: ${allowed}."` (with `(terminal)` when `allowedNext` is empty) matches the spec exactly. The test at plan lines 122–155 asserts both the normal and the terminal-state variants.
- Self-transition handling: `canTransition(s, s) === true`; `assertTransition(s, s)` is `void`; `writeState` returns early with zero `gh` calls. All three are tested.
- `WORKFLOW_STATES` is `as const`, `WorkflowState` is `(typeof WORKFLOW_STATES)[number]`, and `TRANSITIONS` is keyed by `WorkflowState` — adding a state requires touching exactly one declaration (matches spec line 55).
- `state-store.ts` imports `RepoRef` from `../core/types.js` (single canonical type), and `commands/state.ts` imports it via the `state-store.ts` re-export. No drift after the round-1 relocation.
- `gh issue edit --remove-label X --add-label Y` in a single invocation matches the spec atomicity requirement (line 68); the test at plan lines 373–384 asserts both flags appear in one call.
- `gh label create … --force` is idempotent for create-or-update, so the unconditional pre-write call is safe to run on every transition.
- Exit codes: `0` success, `1` invalid transition or generic error, `2` no state label on `state get`, `3` missing `ISSUEFLOW_ENGINE`, `4` `MultipleStateLabelsError`. All map to the spec at line 115 and are exercised by tests.
- `program.exitOverride()` set on the root program cascades to subcommands in Commander 14 — the harness pattern is correct.
- `parseAsync` correctly awaits async action handlers, so the tests' `await program.parseAsync(...)` resolves only after `setExitCode` has been called.
- `parseIssueNumber` rejects `0`, negatives, non-integers, and trailing garbage by comparing `String(parsed) !== value.trim()`.
- `isKnownWorkflowState` correctly narrows the `--to` string to `WorkflowState` before the call to `writeState`, so the `target: WorkflowState` assignment is sound.
- `MultipleStateLabelsError` constructor signature is now `(issueNumber: number, labels: string[])`, matching round-1 Finding 6's suggestion. The test instantiations compile cleanly without `as` assertions.
- README usage section appends to the existing `## Usage` section; the structure of `README.md` does have such a section.
- `tsconfig.json` includes `src/**/*.ts`, so the new `src/workflow/state-machine.ts`, `src/workflow/state-store.ts`, and `src/commands/state.ts` are picked up by `tsc -p tsconfig.json` automatically.
- Vitest hoists `vi.mock('execa', …)` above the `await import('execa')` and the static imports of `state-store.js`, so the production code in `defaultRunner` does see the mocked `execa` during the `defaultRunner` tests. (The hoisting works; the issue noted in Finding 1 is about whether the production call path actually surfaces the mocked rejection — which it would not in real execa 9.)
- `state-command.test.ts` covers all required exit-code transitions: 1 (invalid transition, unknown --to, uninitialised issue), 2 (null state on get), 3 (missing ISSUEFLOW_ENGINE on transition), 4 (multi-state-labels on both get and transition).
