# Implementation Review — Issue #29, Round 1

## Status
pass_with_findings

## Verification commands run
- `npm test`: PASS — 38 test files, 278 tests, all green. New files contribute 3 tests (`verification-gate.test.ts`), 5 tests (`verdict-store.test.ts`), 5 tests (`gate-command.test.ts`), 10 tests (`pr-command.test.ts`), 3 tests (`gate-pr-command.test.ts`), plus 2 new assertions in `cli.test.ts` (now 8 tests).
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `dist/src/commands/{gate,pr}.js` and `dist/src/verification/{gate,verdict-store}.js` are emitted.

## Acceptance criteria

- **PR cannot be created if verification fails** — Met. `assertPrGate` in `src/commands/pr.ts` enforces four sequential checks: state must be `pr-ready`, verdict must be `pass`, latest run status must be `pass`, and `verdictRecord.runId` must match `latestRun.runId` (stale-pass guard). Exit code `1` on any failure. All five `assertPrGate` unit paths and the `prCreateAction` integration paths are tested.
- **Gate verdict is recorded against the issue** — Met. `writeVerdict` in `verdict-store.ts` swaps labels atomically via `gh issue edit --add-label ... --remove-label ...` (with `gh label create --force` upsert). `writeGateVerdictRecord` writes `gate-verdict.json` under the `git rev-parse --git-path`-resolved path. Integration test reads the file back after `gateEvaluateAction`.
- **Gate failures put the issue into a state with a clear next action** — Partially met. `gateEvaluateAction` transitions `verifying → implementing` on fail and stores `nextAction` in `gate-verdict.json`. However, for the `fail` outcome the `nextAction` string is **not printed to stderr** — only `reason` and the state transition are printed to stdout. The `no-run` path correctly prints `nextAction` to stderr. The spec acceptance criterion says "CLI prints the same string on stderr"; the fail path does not satisfy this. The plan's code also omitted this, so the deviation is plan-consistent but spec-inconsistent.

## Findings

1. **Important — `gateEvaluateAction` does not catch `MultipleVerdictLabelsError`**
   (`src/commands/gate.ts:144`, `src/verification/verdict-store.ts:129-131`)

   `readVerdict` can throw `MultipleVerdictLabelsError` when an issue has both `verification:pass` and `verification:fail` labels. The spec error table says this should exit `4` with no state change. `prCreateAction` handles this correctly (lines 161–165 in `src/commands/pr.ts`), but `gateEvaluateAction` has no equivalent handler. If the error is thrown, it propagates as an unhandled rejection through Commander's action wrapper and exits with a non-deterministic code and no user-friendly message.

   Fix: wrap the `readVerdict` call (and the subsequent `writeVerdict`) in a try/catch that checks for `MultipleVerdictLabelsError`, prints the error message to stderr, and calls `deps.setExitCode(4)`.

2. **Important — `fail` outcome does not print `nextAction` to stderr**
   (`src/commands/gate.ts:161–163`, spec acceptance criteria §3)

   When `gateEvaluateAction` evaluates a failing run it only emits:
   ```
   Gate: FAIL - Verification run <id> failed.
   State: verifying -> implementing
   ```
   to stdout. The spec requires: "CLI prints the same string on stderr" (referring to `nextAction`, e.g. "Fix failing checks, run `freesolo verify`, then `freesolo gate evaluate`."). Agents and operators watching stderr for next-action guidance will not see it.

   Fix: after writing the state transition, add `deps.write('stderr', `${evaluation.nextAction}\n`)` when `evaluation.outcome === 'fail'`.

3. **Nit — ASCII separators in stdout instead of Unicode**
   (`src/commands/gate.ts:161–162`, plan Task 3 Step 3)

   The plan specifies Unicode em dash and arrow (`—`, `→`) in the stdout lines; the implementation emits ASCII ` - ` and `->`. No tests enforce the exact format, and this has no functional effect. Flag here for visibility in case downstream tooling parses the gate output.

## Improvements over the plan

- **Worktree-aware `getGateVerdictPath`** (`src/verification/verdict-store.ts:175–184`). The plan used a sync `path.join(repoRoot, '.git', ...)` for the verdict file path. The implementation instead calls `git rev-parse --git-path` (matching `store.ts`), which correctly resolves the path inside git worktrees where `.git` is a file pointer rather than a directory. The `verdict-store.test.ts` test was correspondingly updated to `git init` the temp directory rather than `mkdir .git`.

- **Extra integration test** (`tests/integration/gate-pr-command.test.ts:161–197`). The plan specified 2 integration tests; the implementation adds a third: "pr create --print-only exits 1 when latest run itself failed." This covers the direct-fail case (no stale verdict involved), improving confidence in the gate enforcement path.

## What looks good
- `evaluateGate` is a side-effect-free pure function with a clean null → no-run, pass → pass, fail → fail mapping. The three unit tests cover all branches exactly.
- All commands follow the same dependency-injection pattern (`GateCommandDeps`, `PrCommandDeps`) established by earlier commands, making every branch testable without I/O.
- `assertPrGate` is pure and exported, giving it its own test suite independent of the command plumbing. The stale-verdict check (runId mismatch) is precisely the right guard to prevent an agent from creating a PR after a silent re-run.
- `writeVerdict` correctly creates labels on demand with `--force` before the swap, avoiding a race where the label doesn't exist yet.
- `MultipleVerdictLabelsError` carries the structured `issueNumber` and `labels` fields (matching the `MultipleStateLabelsError` pattern from #17) so callers can surface meaningful diagnostics.
- NodeNext `.js` import extensions are consistent throughout all new source and test files.
- `type`-only imports are correctly marked with `import type` across all new files.
- `cli.ts` is wired correctly: `registerGateCommands(program)` and `registerPrCommands(program)` are called in the right order alongside existing command groups, and both `cli.test.ts` additions assert the `--issue` option is non-mandatory.

STATUS=pass_with_findings
