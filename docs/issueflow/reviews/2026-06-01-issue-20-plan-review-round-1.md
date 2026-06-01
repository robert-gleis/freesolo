# Plan Review Round 1 — Issue #20

## Status
pass_with_findings

## Summary
The plan is scoped to issue #20 (it does not sneak in PR-blocking or reviewer-artifact features) and the task ordering, type names, and dependency-injection style are internally consistent and a good fit for the existing `src/commands/start.ts` pattern. However, the plan silently drops the spec's SIGINT/partial-run guarantee, buffers all per-check output in memory instead of streaming it, and inherits a latent relative-path bug from the existing `getIssueflowPath` helper for the `resolveIssueNumber` session-state read. A fixer should patch these before implementation.

## Findings

1. **SIGINT / exit-code-130 contract dropped silently**
   - Affects: spec §Error Handling, plan Task 4 (`src/verification/runner.ts`), Task 6 (`verifyAction`), Task 9 Self-Review.
   - What's wrong: The spec is explicit that `issueflow verify` v1 must, on SIGINT, kill the current check (recording it with `status: 'fail'`, `signal: 'SIGINT'`), mark remaining checks `'skipped'`, write `run.json` so the partial run is inspectable, and exit `130`. The plan's `runVerificationPipeline` has no SIGINT handler, no abort/cancellation flag, and never propagates a signal to write a partial `run.json`. The Task 9 self-review acknowledges the omission but only excuses it from tests — the implementation is also missing, not just the assertion.
   - Why it matters: The acceptance criterion "Results are persisted and retrievable by issue id" combined with the spec's exit-code table makes SIGINT-with-partial-persistence a contract this ticket promises. Pushing it to a later ticket is a scope cut that the spec did not authorise.
   - Suggested fix: Either (a) implement it — install a one-shot `process.once('SIGINT', ...)` in `verifyAction` (or pass an `AbortSignal` into the runner) that sets a `cancelled` flag, calls `subprocess.kill('SIGINT')` on the current child, lets the existing `bailed`-style loop mark the remainder `'skipped'`, then writes `run.json` and sets `process.exitCode = 130`; cover it with a unit test that injects a stub `execCheck` returning `{ exitCode: null, signal: 'SIGINT' }` and an `onCancel` callback. Or (b) update the spec to drop the SIGINT guarantee from v1 before this plan moves on — but that is a spec change, not a plan change.

2. **Logs are buffered fully in memory, contradicting the spec's "streams into the log file" promise**
   - Affects: plan Task 4 — `runVerificationPipeline` and `defaultRunPipelineDeps.execCheck`.
   - What's wrong: The spec architecture says the runner "writes logs as they stream" and the data-flow step 7 says "streams `all` into the log file with line prefixes". The plan instead accumulates the entire prefixed output in `let logBuffer = ''` and calls `fs.writeFile(logPath, logBuffer)` once after the child exits. A long-running test suite that prints tens of MB of output would balloon the runner's heap, and a SIGKILL-from-OS or crash mid-check would leave zero log content (the file is never opened until the end).
   - Why it matters: Lint/test output for real repos is exactly the kind of thing that produces large logs. Buffering also defeats the "tail the log while it runs" mental model the spec describes.
   - Suggested fix: Open the log with `fs.open(logPath, 'w')` (or use `createWriteStream`) before invoking `execCheck`, pass the write handle (or a `write(stream, text)` callback) into the deps interface, and have the default `execCheck` write each chunk straight through. Tests can stub `execCheck` to call the write callback, and the runner test that asserts `[stdout] stub-output` still passes. Close the file in a `finally` so partial output survives crashes.

3. **`resolveIssueNumber` default deps inherit a relative-path bug from `getIssueflowPath`**
   - Affects: plan Task 5 (`src/core/issue-id.ts` `defaultDeps.readSessionFile`) — depends on `src/core/session-state.ts::getIssueflowPath`.
   - What's wrong: `getIssueflowDir` returns `git rev-parse --git-path issueflow` verbatim. Inside the main worktree git returns a **relative** path (`.git/issueflow`), not an absolute one; `path.join('.git/issueflow', 'session.json')` is still relative, so `fs.readFile` resolves it against `process.cwd()`, not against `worktreePath`. The plan's own `store.ts::gitIssueflowPath` correctly handles this with `path.isAbsolute(resolved) ? resolved : path.join(repoRoot, resolved)`, but the new `resolveIssueNumber` does not, so running `issueflow verify` from a sub-directory of the main worktree (e.g. `cd src && issueflow verify`) would silently fail to find `session.json` and then fall through to the branch-name parser — surprising and untested.
   - Why it matters: Verify is supposed to be runnable anywhere inside the worktree (the spec says `issueflow verify needs an --issue <number> or an issueflow session in the current worktree`). The session-state read should not be sensitive to `process.cwd()`.
   - Suggested fix: In `defaultDeps.readSessionFile`, mirror the store's pattern — `const sessionPath = await getIssueflowPath(worktreePath, 'session.json'); const resolved = path.isAbsolute(sessionPath) ? sessionPath : path.join(worktreePath, sessionPath);` — or, better, fix `getIssueflowPath` once in `session-state.ts` to always return an absolute path (the existing call sites pass `worktreePath` that is always the worktree root, so this is safe). Add a test case where the session file lives at `<worktreePath>/.git/issueflow/session.json` and the resolver is called with a `cwd` that is not the worktree root.

4. **Schema-version literal type will widen and break `schemaVersion: 1` assignability**
   - Affects: plan Task 1 (`src/verification/types.ts` — `VerificationRun.schemaVersion: 1`) and Task 4 (`runVerificationPipeline` return-object literal `schemaVersion: 1`).
   - What's wrong: The interface declares `schemaVersion: 1` (a literal type). In the runner's `return { schemaVersion: 1, ... }`, TS may widen `1` to `number` depending on contextual inference — usually it's fine inside a typed return position, but the verify-command tests construct `VerificationRun` objects inline in `runPipeline` stubs (e.g. plan lines 1259, 1329, 1383) with `schemaVersion: 1` and no `as const`. If contextual typing fails (e.g. when the inferred return type chain uses `Promise<VerificationRun | undefined>`), `1` widens to `number` and TS fails. The test on plan line 1297 (`return undefined as unknown as VerificationRun`) makes the inferred type messier than the rest.
   - Why it matters: This is the kind of TS error that surfaces only when running `npm run build`, not the focused vitest run. Task 9 step 2 will fail and confuse a fixer.
   - Suggested fix: Define `schemaVersion: 1 as const` in the runner return, or relax the type to `schemaVersion: number` (less safe) or `schemaVersion: 1` plus `as const` annotations in all five test fixtures. Easiest: keep the literal type and add `as const` to every test fixture that constructs a `VerificationRun`.

5. **`subprocess.stdout?.on('data', ...)` may race against execa's internal consumption**
   - Affects: plan Task 4 `defaultRunPipelineDeps.execCheck`.
   - What's wrong: With execa 9's defaults (`buffer: true`, no explicit `stdout`/`stderr` option), execa attaches its own readers to the child's stdout/stderr to populate `result.stdout` / `result.stderr`. Adding a second `data` listener works because Node Readable streams broadcast in flowing mode, but execa may pause the stream during back-pressure and any chunk delivered before the user-side listener attaches is lost (execa attaches synchronously inside `execa()`, the plan attaches one microtask later). For short children this race is invisible; for fast-exiting children (`node -e 'process.stdout.write("ok"); process.exit(0)'`) the integration test could be flaky.
   - Why it matters: The Task 8 integration test relies on `expect(passLog).toContain('[stdout] ok')` — exactly the fast-exiting-child case.
   - Suggested fix: Either set `buffer: false` (and rely solely on the user-side listener), or use execa's `subprocess.iterable({ from: 'stdout', binary: false })` / `subprocess.readable()` helpers, or post-process `result.stdout` + `result.stderr` after `await subprocess` (giving up on streaming, which conflicts with finding #2 but is at least race-free). The simplest robust option: set `buffer: false, stdout: ['pipe'], stderr: ['pipe']` and attach listeners synchronously.

6. **`prefixLines` produces malformed log content when stdout/stderr chunks arrive without trailing newlines**
   - Affects: plan Task 4 `prefixLines` + runner loop.
   - What's wrong: `prefixLines` prefixes every line at the moment a chunk arrives. If a child emits `process.stdout.write('part1 ')` then `process.stdout.write('part2\n')`, the buffer becomes `'[stdout] part1 [stdout] part2\n'` — the second chunk gets a fresh `[stdout]` prefix mid-line, mangling the output. The runner-test fixture happens to call `onChunk` once per check with a complete string, so the unit tests don't catch this; the integration test is fast enough to receive the whole output in one chunk on most machines, but it is timing-dependent.
   - Why it matters: The persisted logs are part of the v1 contract — debugging a real failing check is the whole point. Truncated or interleaved prefixes will make logs misleading.
   - Suggested fix: Maintain a small per-stream `tail` buffer in the closure; only emit prefixed lines when a `\n` is seen, and on close flush the remaining tail. Alternatively, line-buffer at the source (use `readline.createInterface` on each stream). Add a unit test that calls `onChunk('stdout', 'part1 ')` then `onChunk('stdout', 'part2\n')` and asserts the log contains exactly `[stdout] part1 part2\n`.

7. **Runner never asserts that `signal` is captured on a signal-killed check**
   - Affects: plan Task 4 test file `tests/unit/verification-runner.test.ts`.
   - What's wrong: The spec calls out `signal` as a first-class result field ("`CheckResult.status = 'fail'` if `exitCode !== 0` or the process was killed by a signal"; "killed by a signal → recorded with `exitCode: null`, `signal` set"). No test exercises a stub that returns `{ exitCode: null, signal: 'SIGTERM' }` and asserts `run.checks[0].signal === 'SIGTERM'` and `run.checks[0].status === 'fail'`.
   - Why it matters: A subtle bug in `aggregateStatus` or the result mapping (e.g. treating `exitCode === 0` as pass even when signal is set — which the current code does because `exitCode === null` for a signal kill would fall through to `'fail'`, but the chain is fragile) would not be caught.
   - Suggested fix: Add a test case "records signal-killed checks as fail" using the stub `execCheck: async () => ({ exitCode: null, signal: 'SIGTERM' })` and assert `signal` on the result.

8. **`writeRun` is double-called: runner already writes nothing but plan calls `writeRun` from verify command without the runner persisting**
   - Affects: plan Task 3 (`store.writeRun`), Task 4 (`runVerificationPipeline`), Task 6 (`createVerifyPlan` calling `deps.writeRun(run)`).
   - What's wrong: This is fine in isolation, but the spec's data-flow step 9 says "Writes `run.json`" without specifying who. The plan splits responsibilities so the runner returns the `VerificationRun` object and the command calls `writeRun(run)`. That works, but the runner already created `runDirectory` (Task 4 step `fs.mkdir(input.runDirectory, ...)`). So if `runPipeline` succeeds and then `writeRun` fails (e.g. permissions), the per-check logs are persisted but no `run.json` — and there is no test for the failure mode. Not critical, just worth noting that the partial-state contract is fuzzy.
   - Why it matters: Disk-full or permission errors are real; the spec's "hard error / soft error" table implies any "run directory cannot be created" is hard, but doesn't cover "logs written but run.json failed".
   - Suggested fix: Move the `await deps.writeRun(run)` call inside `runVerificationPipeline` so the run directory, logs, and `run.json` are written together by the same component. Then `createVerifyPlan` no longer needs the `writeRun` dep at all. Alternatively, document the behaviour and add a test.

9. **`resolveIssueNumber` accepts `0` as a valid override**
   - Affects: plan Task 5 — `resolveIssueNumber`.
   - What's wrong: `if (typeof override === 'number' && Number.isFinite(override)) return override;` — `0` is finite, so `--issue 0` would be accepted. Issue numbers are positive integers (the existing `sessionStateSchema.issueNumber` uses `z.number().int().positive()`).
   - Why it matters: A user typing `--issue 0` would end up with `.git/issueflow/verifications/issue-0/...` which is gibberish and makes future `loadLatestRun(repoRoot, 0)` calls surprising.
   - Suggested fix: `if (typeof override === 'number' && Number.isInteger(override) && override > 0) return override;` and add a test "rejects --issue 0" → `IssueIdError`.

10. **`tests/unit/verification-runner.test.ts` trailing `export type _ForceImport = ExecCheckResult;`**
    - Affects: plan Task 4 test file.
    - What's wrong: The plan adds an `export` from a `.test.ts` file purely to keep an import alive. This is a code smell, an ESLint trigger in many configs, and unnecessary because Vitest does not tree-shake imports of test files. The note says "delete it if any linter flags it; it does not change runtime behaviour" — better to delete it preemptively.
    - Why it matters: Adds a confusing artefact to the repository.
    - Suggested fix: Remove the `_ForceImport` line and instead reference `ExecCheckResult` inside the test body (e.g. typing one of the `execCheck` return values with `satisfies ExecCheckResult`), or just drop the unused import if the test does not need it.

## Notes

- Naming: the plan's `RunStatus` is `'pass' | 'fail'` and `CheckStatus` is `'pass' | 'fail' | 'skipped'`. That matches the spec, but be careful in the runner: `aggregateStatus` returns `'pass'` only if every check is `'pass'`, which means a `'skipped'` check yields a `'fail'` run — consistent with the spec.
- `defaultRunId(now)` formats the run id with `now.toISOString().replace(/[:.]/g, '-')`, e.g. `2026-06-01T10-00-00-000Z`. Filesystem-safe on all platforms and stable for `listRuns` lex-sort. Good.
- The store's `listRuns` does `entries.slice().sort().reverse()` over directory names; with the ISO-with-dashes runId the lexicographic order matches chronological order, so this is correct. If anyone later adds a non-ISO runId, this assumption breaks — worth a one-line comment in the source.
- Consider exporting `defaultRunPipelineDeps` and `defaultVerifyPlanDeps` as named exports so the integration test (which already imports `defaultVerifyPlanDeps`) is the single, type-checked seam.
- The plan's Task 7 modifies `tests/unit/cli.test.ts` by appending a new `it(...)` — make sure the fixer keeps the existing two `it(...)` blocks intact (the plan shows the full file, which is good practice).
- No findings against the issue acceptance criteria themselves: configurable checks, structured pass/fail with logs, deterministic re-runnable runs, and retrievable-by-issue-id are all covered by the plan as currently written (modulo the SIGINT-partial-run gap in finding #1, which is a *spec* requirement separate from the four issue acceptance bullets).
