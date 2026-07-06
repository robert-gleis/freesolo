# Verification Pipeline Design

Spec for issue [#20](https://github.com/robert-gleis/freesolo/issues/20). Parent: epic #12 (Verification System).

## Summary

A configurable pipeline of independent checks that runs against agent output. The pipeline is authoritative: agents do not self-certify. This ticket delivers the pipeline runner, its config schema, persistence, and a new `freesolo verify` CLI command. It does not block PR creation, generate reviewer artifacts, or auto-detect defaults — those are sibling tickets in epic #12.

## Goals

- Run a configurable, ordered list of checks against the current repo state.
- Produce a structured pass/fail result per check, plus an aggregated pipeline verdict.
- Capture per-check logs (stdout/stderr) for later inspection.
- Persist run results so they are retrievable by issue id.
- Run deterministically: same config, same code, same environment → reproducible result independent of prior runs.
- Allow re-running on the same artifact (same commit) without prior runs interfering.

## Non-Goals

- Blocking PR creation on failure (covered by the Verification Gate ticket).
- Generating reviewer artifacts from run data (covered by Reviewer Artifact Generation).
- Auto-detecting checks from `package.json`, framework, or language. The config is the source of truth.
- Parallel check execution. Sequential is sufficient for v1 and keeps logs and reasoning simple.
- Watching, scheduling, or hooking into CI runners. The pipeline is invoked explicitly.
- A TUI for run history. Run data is plain JSON on disk.

## CLI Surface

A new subcommand on the existing `freesolo` binary:

```
freesolo verify [--issue <number>] [--config <path>] [--print-only] [--bail]
```

Options:

- `--issue <number>`: Issue id this run is associated with. If omitted, resolution order is:
  1. `.git/freesolo/session.json` `issueNumber` field.
  2. Branch name match `issue/<number>-<slug>`.
  3. Error: `freesolo verify needs an --issue <number> or an freesolo session in the current worktree.`
- `--config <path>`: Path to the config file. Defaults to `freesolo.config.json` in the repo root.
- `--print-only`: Print the resolved check plan and the run directory that *would* be written, then exit with code 0. No subprocesses are spawned.
- `--bail`: Stop the pipeline after the first failing check. Default is to run every check so users see the full picture.

Exit codes:

- `0`: All checks passed.
- `1`: At least one check failed.
- `2`: Pipeline could not start (missing config, invalid config, unresolved issue id, etc.). The CLI prints a clear message describing the cause.
- `130`: Pipeline cancelled by SIGINT. A partial `run.json` is still written.

## Config File

Path: `freesolo.config.json` at the repo root. Single source of truth, validated with zod. Required for `freesolo verify` to do anything useful — there is no implicit default check set in v1.

Shape:

```json
{
  "verification": {
    "checks": [
      { "name": "lint",              "command": "npm", "args": ["run", "lint"] },
      { "name": "typecheck",         "command": "npm", "args": ["run", "typecheck"] },
      { "name": "unit-tests",        "command": "npm", "args": ["test"] },
      { "name": "integration-tests", "command": "npm", "args": ["run", "test:integration"] }
    ]
  }
}
```

Per-check fields:

- `name` (required): Identifier used in result records and log filenames. Must be unique within the file. Validated against `^[a-z0-9][a-z0-9-]{0,63}$` so it is filesystem-safe.
- `command` (required): Executable to invoke. Resolved through the shell `PATH`. Not interpreted by a shell — no string-splitting, no glob expansion. Spaces in arguments belong in `args`.
- `args` (optional, default `[]`): String array of arguments.
- `cwd` (optional, default repo root): Working directory for this check. Relative paths resolve against the repo root.
- `env` (optional, default `{}`): Extra environment variables merged on top of the inherited environment.

Validation errors point at the offending check by index and name where available. A config without `verification.checks` or with an empty array is rejected with `verification.checks must contain at least one check`.

## Result Model

Each pipeline invocation is a run. A run contains an ordered list of check results.

```ts
interface CheckResult {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  status: 'pass' | 'fail' | 'skipped';
  exitCode: number | null;
  startedAt: string;          // ISO 8601
  finishedAt: string;         // ISO 8601
  durationMs: number;
  logPath: string;            // absolute path to <check>.log
  signal: string | null;      // signal name if killed by signal
}

interface VerificationRun {
  schemaVersion: 1;
  runId: string;              // YYYY-MM-DDTHH-MM-SS-mmmZ
  issueNumber: number;
  repoRoot: string;
  configPath: string;
  startedAt: string;
  finishedAt: string;
  status: 'pass' | 'fail';
  bail: boolean;
  checks: CheckResult[];
}
```

Status rules:

- `CheckResult.status = 'pass'` iff `exitCode === 0`.
- `CheckResult.status = 'fail'` if `exitCode !== 0` or the process was killed by a signal.
- `CheckResult.status = 'skipped'` if `--bail` aborted the pipeline (or SIGINT cancelled it) before this check ran.
- `VerificationRun.status = 'pass'` iff every check has status `'pass'`. Any `'fail'` or `'skipped'` check makes the run `'fail'`.

## Persistence

Run data lives under `.git/freesolo/verifications/issue-<N>/<runId>/`. This is per-worktree local state, matching the existing `.git/freesolo/session.json` convention. Reasons:

- Verification logs can be large (test output, lint output). Committing them would bloat history.
- Freesolo's orchestration state already lives under `.git/freesolo/`. Verification fits the same lifecycle.
- The acceptance criterion "retrievable by issue id" requires structured local-or-remote storage, not necessarily git history. Local files satisfy it.

Per-run layout:

```
.git/freesolo/verifications/issue-20/2026-06-01T07-50-00-000Z/
  run.json
  lint.log
  typecheck.log
  unit-tests.log
  integration-tests.log
```

`run.json` contains the `VerificationRun` record. Each `<check-name>.log` contains interleaved stdout/stderr captured during that check, prefixed per line so the source stream is recoverable:

```
[stdout] running eslint...
[stderr] warning: foo
```

There is no rotation, retention, or size cap in v1. Users can delete old run directories manually.

## Determinism and Re-Run

"Deterministic" here means: given the same config and the same on-disk repo state, two invocations produce results that differ only in timestamps, run ids, and any non-determinism inside the checks themselves. The runner does not:

- Read or write any state outside the current run directory.
- Read prior run results to influence the current run.
- Reorder, deduplicate, or batch checks.

Re-running on the same artifact is just running `freesolo verify` again. Each invocation creates a new `runId`. Prior runs are untouched.

## Architecture

New files under `src/verification/`:

- `types.ts` — `VerificationCheckSpec`, `CheckResult`, `VerificationRun`, plus the `VerificationConfig` zod-derived type.
- `config.ts` — `loadVerificationConfig(repoRoot, configPath?)`. Reads the file, validates with zod, returns the typed config. Throws `VerificationConfigError` with file path and underlying message.
- `runner.ts` — `runVerificationPipeline(input, deps)`. Iterates checks, spawns subprocesses, collects results, writes logs as they stream, returns the `VerificationRun`.
- `store.ts` — `getRunDirectory(repoRoot, issueNumber, runId)`, `writeRun(run)`, `listRuns(repoRoot, issueNumber)`, `loadLatestRun(repoRoot, issueNumber)`. Pure filesystem operations.

New CLI command:

- `src/commands/verify.ts` — `verifyAction(options)` and `createVerifyPlan(input, deps)` mirroring the existing pattern in `src/commands/start.ts` (dependency-injected for tests).
- `src/cli.ts` — register the `verify` subcommand on the commander program.

Resolution helpers reused or extended:

- `src/core/git.ts::resolveRepoRoot` — already exists.
- A new `src/core/issue-id.ts::resolveIssueNumber(repoRoot, overrideNumber?)` that walks the session-state file then the current branch name. Lives in `core` so other commands can reuse it later.

## Data Flow

1. CLI parses options. Resolves `repoRoot` via `resolveRepoRoot`.
2. Resolves `issueNumber` via override → session → branch.
3. Loads config via `loadVerificationConfig`.
4. Builds the run plan: a `VerificationRun` skeleton with `checks` initialised to `'skipped'` placeholders.
5. If `--print-only`: prints the plan and target run directory, exits 0.
6. Otherwise: creates the run directory, opens per-check log files lazily, iterates checks.
7. For each check, spawns `execa` with `{ command, args, cwd, env, reject: false, all: true }`, streams `all` into the log file with line prefixes, awaits exit, records the result.
8. If `--bail` and the latest check failed, remaining checks stay `'skipped'`.
9. Writes `run.json`. Prints a one-line summary per check plus the aggregate verdict. Exits 0 on pass, 1 on fail.

## Error Handling

Hard errors (exit code 2, nothing persisted):

- Repo root cannot be resolved.
- Issue number cannot be resolved.
- Config file missing.
- Config file invalid JSON or fails zod validation.
- Run directory cannot be created (e.g. permissions).

Soft errors (recorded as check failures, pipeline continues unless `--bail`):

- A check command is not on `PATH` → execa rejects → recorded with `exitCode: null`, `status: 'fail'`, signal or error message captured in the log.
- A check exits non-zero → recorded with the exit code.
- A check is killed by a signal → recorded with `exitCode: null`, `signal` set.

Cancelled runs (SIGINT during a check):

- The current check is killed, recorded with `status: 'fail'`, `signal: 'SIGINT'`.
- Remaining checks stay `'skipped'`.
- `run.json` is still written so the partial run is inspectable.
- CLI exits with code 130.

## Testing Strategy

Unit tests:

- `tests/unit/verification-config.test.ts`
  - Loads a valid file.
  - Rejects missing `verification.checks`.
  - Rejects empty `checks` array.
  - Rejects duplicate `name`.
  - Rejects `name` failing the regex.
  - Surfaces JSON parse errors with the file path.
  - Defaults `args`, `cwd`, `env` correctly.
- `tests/unit/verification-runner.test.ts`
  - All checks pass → run status `'pass'`, each check `'pass'`.
  - One check fails, no bail → all subsequent checks still run, run status `'fail'`.
  - One check fails with bail → subsequent checks stay `'skipped'`, run status `'fail'`.
  - Command not on PATH → recorded as `'fail'` with the error message in the log.
  - Log file contains both stdout and stderr from a noisy check.
- `tests/unit/verification-store.test.ts`
  - `writeRun` creates the directory and `run.json`.
  - `listRuns` returns runs sorted by `runId` desc.
  - `loadLatestRun` returns the newest run or `null` when none exist.
- `tests/unit/issue-id.test.ts`
  - Override wins.
  - Session-state fallback.
  - Branch-name fallback (`issue/20-foo`).
  - Throws when nothing resolves.
- `tests/unit/verify-command.test.ts`
  - `--print-only` lists the plan without running checks.
  - End-to-end with stub deps: pipeline result mapped to exit code 0 or 1.
  - Hard error path: missing config → exit code 2.

Integration test:

- `tests/integration/verify-command.test.ts`
  - Creates a temp repo, initialises git, writes a config with a passing `node -e ...` check and a failing one, runs `freesolo verify --issue 99`, asserts:
    - exit code 1
    - `run.json` exists under `.git/freesolo/verifications/issue-99/<runId>/`
    - logs exist for both checks
    - aggregated status is `fail`

## Backwards Compatibility

This change is additive:

- New CLI subcommand. The existing `start` command is unchanged.
- New optional repo-root config file. Repos without it cannot use `verify` but are otherwise unaffected.
- No changes to session-state schema, host integration assets, or the workflow kernel for the user-facing flow. The kernel does not yet mention this pipeline; wiring the agent into the new command is a follow-up if desired.

## Open Decisions

None for v1. The Verification Gate ticket will decide how PR creation consumes these results.
