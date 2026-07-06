# Plan Review — Issue #17 — Round 3

**Status:** pass_with_findings

## Summary
Round 2's three concerns are addressed correctly: `defaultRunner` now drops `reject: false` so the ENOENT mapping is reachable (and the test mocks `execa` rejections, which matches real execa 9 behaviour); `tests/unit/state-store.test.ts` adds the `beforeEach(() => vi.mocked(execa).mockReset())` pattern mirroring `tests/unit/github.test.ts`; and both `MultipleStateLabelsError` tests now assert `expect(io.stdout).toEqual([])`. One genuine new defect was introduced in the `defaultRunner` ENOENT-detection logic, and a couple of polish-level items remain.

## Round 2 follow-up
- Finding 1 (`defaultRunner` ENOENT handler unreachable in production) — **fixed with new issue.** The plan adopted Option 1 (drops `reject: false`, wraps the call in `try/catch`). The structure matches `src/core/github.ts:166-186` (`listAssignedIssues`). The fallback path correctly reconstitutes a `GhResult` from `execaError.exitCode/stdout/stderr` so downstream consumers (`readState`, `writeState`, `createStateLabel`) keep their `result.exitCode !== 0` checks. However the new ENOENT detector is too narrow — see Finding 1 below.
- Finding 2 (no `beforeEach` `mockReset` on the module-level `execa` mock) — **fixed correctly.** Plan lines 270-272 add the reset, matching the established `tests/unit/github.test.ts:13-15` pattern.
- Finding 3 (`MultipleStateLabelsError` tests do not assert stdout is silent) — **fixed correctly.** `state get` test at plan lines 752-756 and `state transition` test at plan lines 887-892 both now include `expect(io.stdout).toEqual([])` in addition to the stderr/exit-code assertions.

## Findings

### Finding 1: `defaultRunner` ENOENT detector matches the wrong shape of execa 9 spawn-error
**Severity:** major
**Location:** Plan Task 2, Step 3 — `src/workflow/state-store.ts` `defaultRunner` (plan lines 470-497); test at plan lines 408-414.
**Problem:** The detector is `if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')`. In execa 9 the *rejection* for a missing binary is not a plain `NodeJS.ErrnoException` — it is an `ExecaError` whose underlying ENOENT cause is exposed on `error.cause` (a `NodeJS.ErrnoException` with `code === 'ENOENT'`) rather than on the top-level `error.code`. The top-level `error.code` on `ExecaError` is documented as the spawn-time error name (`'ERR_SUBPROCESS_FAILED'` / similar) and the rejection's own `code` property is *not* `'ENOENT'`. So in real use against execa 9, the ENOENT branch never fires and the catch block falls through to the `execaError` GhResult shape with `exitCode: 1, stdout: '', stderr: ''` — meaning a missing `gh` will surface to `readState` as the generic `'Failed to read labels for issue #N: gh exited non-zero'` instead of the friendly install hint. The unit test passes only because it fabricates a *plain* `Error` with `code: 'ENOENT'` set directly, which does not match how execa 9 actually rejects.
**Why it matters:** This is exactly the regression round 2 Finding 1 was trying to prevent — UX parity with `listAssignedIssues`. Note that `src/core/github.ts:184-186` does *not* try to detect ENOENT specifically; it catches *any* execa rejection and throws the friendly message unconditionally. The new `defaultRunner` is more nuanced (it tries to surface non-zero exits as `GhResult`s so downstream callers can read `stderr`) and that distinction is what makes the ENOENT-vs-other discrimination tricky.
**Suggested fix:** Either (a) match against `error.cause?.code === 'ENOENT'` *in addition to* `error.code === 'ENOENT'`, and have the test fabricate an `Error` with `cause: { code: 'ENOENT' }`, OR (b) drop the discrimination entirely and treat *any* execa rejection that has `exitCode === undefined` as a spawn failure — surface those as the friendly message, and only build a `GhResult` for rejections that carry an `exitCode`. Option (b) is simpler and harder to get wrong across execa upgrades. Confirm the actual rejection shape with a quick `node -e "import('execa').then(({execa})=>execa('does-not-exist').then(()=>{},e=>console.log(JSON.stringify({code:e.code,cause:e.cause?.code,exitCode:e.exitCode}))))"` before locking the test in.

### Finding 2: `defaultRunner` test for "non-zero exit code" does not match real execa rejection shape
**Severity:** minor
**Location:** Plan Task 2, Step 1 — `tests/unit/state-store.test.ts` test `'passes through non-zero exit codes without throwing'` (plan lines 417-428).
**Problem:** The mock rejects with `Object.assign(new Error('command failed'), { exitCode: 1, stderr: 'gh: no auth', stdout: '' })`. Real execa 9 rejects with an `ExecaError` that *also* carries `failed: true`, `isCanceled: false`, `originalMessage`, etc. The plain `Error.assign` shape works for the property reads the production code does (`execaError.exitCode/stdout/stderr`) — so the test isn't strictly wrong — but it cements the same "tests mock the contract, not the library" pattern that landed the round-2 ENOENT issue. If `defaultRunner` ever starts reading `failed` or `shortMessage`, the test will silently keep passing while production breaks.
**Why it matters:** Same maintenance trap as round-2 Finding 1, just smaller scope.
**Suggested fix:** Tighten the test fixture to look more like a real `ExecaError`: at minimum add `failed: true` and `shortMessage: 'Command failed with exit code 1: gh issue view 1'`. Better still, refactor the production code to never touch `execaError` directly — read only documented properties and prefer `error instanceof Error` checks before property access. Not blocking, but worth a polish pass.

### Finding 3: README "Workflow state" snippet uses nested triple-backtick fences without escaping
**Severity:** minor
**Location:** Plan Task 5, Step 1 — README append block (plan lines 1201-1215).
**Problem:** The plan instructs the implementer to append a markdown block that contains a fenced code block inside a fenced code block, both using ```` ``` ````. When the implementer pastes this verbatim, the *outer* fence will close at the first inner ```` ``` ````, breaking the rendering. The plan's own rendering of this snippet (visible at plan lines 1199-1215) demonstrates the issue: the implementer needs to recognise that the "outer" code block in the plan is the plan's own illustration of what to paste, and the actual content to insert is just the markdown text — there is no outer fence in the final README. The instruction is ambiguous.
**Why it matters:** A literal-minded implementer will either paste the fences and break the README, or strip the outer fence and lose context. Either way, the README PR may need a follow-up.
**Suggested fix:** Rewrite the Step 1 instruction to say explicitly "Insert the following markdown verbatim into README.md, immediately after the existing `## Usage` code block (line 52) and before the `## Worktree setup hooks` heading (line 56)" and quote the snippet without an outer code fence, OR use a tilde fence for the outer block (`~~~markdown` … `~~~`) so the inner triple-backticks are unambiguously content.

## Verified OK
- `defaultRunner` test now reflects the plan's "drop `reject: false`" decision: both tests use `mockRejectedValueOnce`, which is what real execa does without `reject: false` for both ENOENT and non-zero exit (the ENOENT *detection* is the issue, not the test's choice of `mockRejected`).
- `beforeEach(() => { vi.mocked(execa).mockReset(); })` in `tests/unit/state-store.test.ts` (plan lines 270-272) matches the `tests/unit/github.test.ts:13-15` pattern verbatim and prevents the mock-leak maintenance trap.
- Both `MultipleStateLabelsError` tests (`state get` at plan lines 747-757, `state transition` at plan lines 872-892) now include `expect(io.stdout).toEqual([])` so a regression that prints partial output before bubbling the error would be caught.
- Drop of `reject: false` aligns `defaultRunner` with `src/core/github.ts:170-185` (`listAssignedIssues`), so on non-zero exit codes execa 9 rejects with an `ExecaError` whose `exitCode`/`stdout`/`stderr` are reachable via the catch branch — the property reads in the catch block are correct, just the ENOENT discriminator is not.
- The plan's transition table (plan lines 184-192) still matches the spec table (spec lines 40-50) exactly: `triaged→[planned]`, `planned→[approved,triaged]`, `approved→[implementing,planned]`, `implementing→[reviewing,approved]`, `reviewing→[verifying,implementing]`, `verifying→[pr-ready,implementing]`, `'pr-ready'→[merged,implementing]`, `merged→[closed]`, `closed→[]`.
- `InvalidTransitionError` message format (plan line 202) matches spec line 83 exactly, including the `(terminal)` fallback when `allowedNext` is empty.
- Exit-code mapping in `state-command.test.ts` covers all four spec-defined codes (1 invalid transition / generic, 2 null state on `get`, 3 missing `FREESOLO_ENGINE`, 4 `MultipleStateLabelsError`) on both the `get` and `transition` paths where applicable.
- Self-transition handling consistent across all three layers: `canTransition(s, s) === true` (state-machine), `writeState` returns before any `gh` call (state-store, plan lines 601-603), and the unit test asserts zero `gh` invocations.
- `gh label create … --force` is called unconditionally before every state-label swap (plan lines 607-610), eliminating the round-1 brittle error-string sniff. The accompanying test (plan lines 359-388) asserts both calls happen in the documented order.
- `RepoRef = Pick<RepoContext, 'owner' | 'repo'>` is appended to `src/core/types.ts` (plan lines 442-444) and re-exported from `src/workflow/state-store.ts` (plan line 456); `src/commands/state.ts` imports the re-export. Single canonical type, no drift.
- `cli.test.ts` registration test (plan lines 1112-1119) uses the same `program.commands.find((c) => c.name() === 'state')` pattern the existing test file uses for `start`.
- The plan's full replacement of `src/cli.ts` (plan lines 1132-1168) is a precise superset of the current file at `src/cli.ts:1-33`, adding the import and `registerStateCommands(program)` call without disturbing existing behavior.
- `parseIssueNumber` (plan lines 965-971) rejects `0`, negatives, non-integers, and trailing garbage via `String(parsed) !== value.trim()`, so the CLI surface is well-defined.
- `isKnownWorkflowState` (plan lines 973-975) correctly narrows `--to` to `WorkflowState` before the `target: WorkflowState` assignment, so the typed call to `writeState` is sound.
- Spec acceptance criteria (spec lines 133-139) are all mapped:
  - Storage in GitHub labels: `state-store.test.ts` `readState`/`writeState`/`ensureStateLabels` against the `state:` prefix.
  - Transitions explicit and enumerable: `TRANSITIONS` is a single `const` and `state-machine.test.ts` enumerates it via `it.each`.
  - Agents cannot bypass: `FREESOLO_ENGINE` gate with exit code 3 enforced and tested.
  - Invalid transitions rejected: `InvalidTransitionError` with the spec-mandated message format.
  - State recoverable: `readState` is stateless and tested against a fake `gh` runner.
