# Implementation Review Round 1 — Issue #20

## Status
pass_with_findings

## Summary
The implementation closely matches the spec and plan: a zod-validated config, a deterministic sequential runner with per-check log streaming, persistent `run.json` keyed by `issue-<N>/<runId>`, an issue-id resolver with override/session/branch fallback, and a `verify` subcommand with `--issue`, `--config`, `--print-only`, `--bail`. The full suite (121 tests, 22 files) passes; `npm run build` succeeds. All four acceptance criteria are met. The findings below are non-blocking gaps in error coverage and end-to-end SIGINT exercise; nothing here would justify holding the merge, but a fixer can address them cheaply before shipping.

## Findings

1. **No end-to-end test exercises real SIGINT against a real subprocess.**
   - Affected: `tests/integration/verify-command.test.ts`; default execCheck path at `src/verification/runner.ts:65-84` and `:155-185`.
   - What's wrong: Every abort-related test (`'marks remaining checks skipped when abortSignal aborts mid-pipeline'`, `'records SIGINT on the running check when abortSignal aborts mid-flight'`, the verify-command 130-mapping tests) uses a stubbed `execCheck`. The production code path that wires `abortSignal.addEventListener('abort', () => subprocess.kill('SIGINT'))` and relies on execa to surface `signal: 'SIGINT'` on the resolved result is never executed by any test. The plan/spec call SIGINT-cancellation an explicit contract (exit code 130, partial `run.json` still written) but that contract is only validated against a stub that returns `{ signal: 'SIGINT' }` on its own — not against execa's actual behaviour.
   - Why it matters: This is exactly the path that determines whether a Ctrl-C during a real `npm test` invocation produces the spec'd `signal: 'SIGINT'` on the `CheckResult` (and therefore exit 130) versus a generic `'fail'` with `signal: null`. If execa's `signal` surfacing ever changes (or differs across platforms), CI would stay green while the production behaviour silently drifted.
   - Suggested fix: Add one integration test that spawns a real `process.execPath -e "setInterval(() => {}, 1000)"` check, fires `controller.abort()` after a tick, and asserts `run.checks[0].signal === 'SIGINT'`, `result.exitCode === 130`, and `run.json` is on disk. Keep the timeout small (1–2 s) and gate the test on `process.platform !== 'win32'` if needed.

2. **`getRunDirectory` is not inside the hard-error try/catch in `createVerifyPlan`.**
   - Affected: `src/commands/verify.ts:113-131`.
   - What's wrong: The try/catch around the resolve block only wraps `resolveRepoRoot`, `resolveIssueNumber`, `loadVerificationConfig`, and `resolveConfigPath`. `getRunDirectory` runs after the catch and can throw (it shells out to `git rev-parse --git-path`). A failure there propagates as an unhandled rejection out of `createVerifyPlan` and `verifyAction`, producing a stack trace and exit code 1 rather than the spec'd hard-error exit code 2 with a clear message.
   - Why it matters: In practice `resolveRepoRoot` makes this nearly unreachable, but on systems where `git rev-parse --show-toplevel` succeeds and `git rev-parse --git-path` then fails (e.g. partially-broken worktree, permission flap, git wrapper script), the user sees an opaque stack instead of the spec'd `Pipeline could not start` style message.
   - Suggested fix: Move the `runId`/`runDirectory` resolution inside the same try/catch, or wrap it in its own try/catch that returns `{ mode: 'error', exitCode: 2, message }` on failure.

3. **`--issue 1abc` is silently accepted as `--issue 1`.**
   - Affected: `src/cli.ts:36` (the `Number.parseInt(value, 10)` coercer) and `src/core/issue-id.ts:53-57`.
   - What's wrong: Commander's coercer uses `Number.parseInt(value, 10)`, which parses leading digits and discards trailing non-numeric content (`'1abc'` → `1`, `'20-foo'` → `20`). `resolveIssueNumber` only checks `Number.isInteger` and `> 0`, so the wrong issue number is accepted without warning. `--issue abc` correctly fails (parseInt → NaN → not-integer → IssueIdError), but the partial-prefix case slips through.
   - Why it matters: Verify runs would be written under the wrong issue directory (`issue-1/...` for `--issue 1abc`), making "retrievable by issue id" deceptive. Real-world risk is small but it's a latent foot-gun.
   - Suggested fix: Either tighten the CLI coercer (`if (!/^\d+$/.test(value)) throw new InvalidArgumentError(...)`) or tighten the resolver to reject when the original string contains non-digits. The first is simpler and produces a cleaner commander error.

## Notes

- The dual `deps.now()` invocation in `buildRun()` means the `finishedAt` on the persisted `run.json` is one tick earlier than the `finishedAt` on the returned `VerificationRun`. Not a correctness issue (both are inside the same call) and the Self-Review Notes flag the design choice, but worth knowing for any future consumer that compares the two.
- The synthetic-error path in the per-check `catch` writes `[stderr] ${message}\n` directly through the open handle. If `message` contains embedded newlines, only the first line is prefixed; subsequent lines appear unprefixed in the log. Cosmetic only — `CheckResult.status` is still correct.
- `summarizeRun` uses a Unicode arrow (`→`). Fine on macOS/Linux UTF-8 terminals; a non-UTF-8 Windows console might mojibake it. Not load-bearing.
- `defaultRunPipelineDeps.execCheck` checks `result.failed && exitCode === null` and surfaces `result.shortMessage ?? result.originalMessage ?? result.code ?? 'spawn failed'`. This is a slight extension beyond the plan's draft (the plan only describes the catch branch) but it correctly handles execa 9's `reject: false` + spawn-failure case and is exercised by the `'records a real ENOENT failure'` test. Good defensive addition.
- `writeRun` in `src/verification/store.ts` is exported but unused by the runner; the inline comment explains why. No dead-code risk.
- Persistence path is per-worktree (via `git rev-parse --git-path`), which the spec endorses as matching the `session.json` convention. Worth keeping in mind that running `issueflow verify` from the main checkout vs. a worktree produces separate, non-overlapping run directories — by design, not a finding.
