# Reviewer Artifact Generation Design

**Issue:** [#30 — Reviewer Artifact Generation](https://github.com/robert-gleis/issueflow/issues/30)
**Parent:** #12 — Epic: Verification System
**Builds on:** #20 (Verification Pipeline, merged)
**Status:** Draft, awaiting user review

## Summary

Generate two stable, machine-readable markdown reports at the end of verification and review steps so humans and future agents can audit what happened without reading raw `run.json` files or per-round review artifacts.

| Artifact | Produced when | Source data |
|---|---|---|
| `TEST_REPORT.md` | `issueflow verify` completes (pass, fail, or SIGINT-cancelled) | Latest `VerificationRun` + per-check log paths |
| `REVIEW_REPORT.md` | A review gate reaches `pass` via `record-review` | Session `reviewGates` / `reviewLoops` + round review markdown files on disk |

Reports live under `.git/issueflow/reports/issue-<N>/` (resolved via `git rev-parse --git-path`), matching the verification persistence convention. Paths are recorded in `session.json` `artifacts.testReport` and `artifacts.reviewReport` so the workflow can retrieve them by issue id.

## Goals

- Automatically write `TEST_REPORT.md` after every completed `issueflow verify` run (not `--print-only`).
- Automatically write or refresh `REVIEW_REPORT.md` when `review-loop.mjs record-review --status pass` runs for either gate.
- Stable report shape: YAML frontmatter (`schemaVersion: 1`) + fixed markdown sections so parsers and humans can rely on structure.
- Reports retrievable by issue id through session state and a new `issueflow reports show` CLI.
- Extend `findIssueArtifacts` (or companion helper) to discover report paths for issue packet / tooling.

## Non-Goals

- Blocking PR creation or workflow transitions on report generation failure (reports are best-effort audit artifacts; hard failures in verify/review still use existing exit codes).
- Committing reports to git history (they are worktree-local under `.git/issueflow/`).
- Replacing per-round review artifacts in `docs/issueflow/reviews/` — those remain the reviewer’s working notes; `REVIEW_REPORT.md` is the aggregated summary.
- Generating reports from the workflow engine tick loop (#24) — hooks live at the existing CLI/script boundaries where verify and review already complete.
- HTML/PDF export, retention policies, or upload to GitHub.

## Considered Options

### A. Hook at CLI/script boundaries (recommended)

- `verifyAction` calls `writeTestReport(run)` after a completed pipeline run.
- `review-loop.mjs` calls a small Node report helper after `record-review --status pass`.

**Pros:** Minimal surface area; matches how operators already invoke verify and review; no engine coupling.
**Cons:** Reports are not produced if someone reads `run.json` manually without running verify.

### B. Workflow engine policy hooks

**Rejected for v1:** Engine does not yet orchestrate verify/review completion; adds coupling before those transitions are engine-driven.

### C. Committed reports under `docs/issueflow/reports/`

**Rejected:** Test output can be large and noisy; verification data already lives in `.git/issueflow/`.

## Architecture

```
src/reports/
  types.ts           # ReportFrontmatter types, REPORT_SCHEMA_VERSION
  test-report.ts     # buildTestReportMarkdown(run) → string
  review-report.ts   # buildReviewReportMarkdown(input) → string
  store.ts           # getIssueReportsDir, writeTestReport, writeReviewReport, read paths
  index.ts           # barrel

src/commands/
  reports.ts         # issueflow reports show [--issue N]

Modify:
  src/commands/verify.ts              # call writeTestReport after completed run
  src/core/types.ts                   # extend IssueArtifactPaths
  src/core/session-state.ts           # extend artifacts schema (optional fields, default null)
  src/core/artifacts.ts               # discover testReport + reviewReport paths
  integrations/skills/issueflow-workflow/scripts/review-loop.mjs
  integrations/skills/issueflow-workflow/scripts/write-review-report.mjs  # thin CLI wrapper for review-loop.mjs
```

Why `src/reports/`:

- Sibling to `src/verification/` under epic #12.
- Keeps markdown formatting logic out of CLI wiring and the review-loop script.

### Report storage layout

```
.git/issueflow/reports/issue-30/
  TEST_REPORT.md
  REVIEW_REPORT.md
```

`getIssueReportsDir(repoRoot, issueNumber)` uses the same `git rev-parse --git-path issueflow/reports/issue-<N>` pattern as `getIssueVerificationsDir`.

### TEST_REPORT.md format

```yaml
---
schemaVersion: 1
kind: test-report
issueNumber: 30
runId: 2026-06-08T12-00-00-000Z
status: pass
generatedAt: 2026-06-08T12:05:00.000Z
repoRoot: /path/to/repo
configPath: /path/to/repo/issueflow.config.json
bail: false
checkCount: 3
passedCount: 3
failedCount: 0
skippedCount: 0
runDirectory: /path/to/.git/issueflow/verifications/issue-30/2026-06-08T12-00-00-000Z
---
# Test Report — Issue #30

## Summary

Verification run **pass** (`2026-06-08T12-00-00-000Z`). 3/3 checks passed.

## Checks

| Name | Status | Duration | Exit | Signal | Log |
|------|--------|----------|------|--------|-----|
| lint | pass | 1.2s | 0 | — | `lint.log` |

## Run metadata

- **Started:** 2026-06-08T12:00:00.000Z
- **Finished:** 2026-06-08T12:05:00.000Z
```

Rules:

- `status` mirrors `VerificationRun.status` (`pass` | `fail`). Cancelled runs (SIGINT) still write a report with `status: fail` and checks marked `fail`/`skipped` as recorded in `run.json`.
- Log column shows basename of `CheckResult.logPath` plus a relative path from `runDirectory` when possible.
- `--print-only` does **not** write a report.

### REVIEW_REPORT.md format

```yaml
---
schemaVersion: 1
kind: review-report
issueNumber: 30
generatedAt: 2026-06-08T14:00:00.000Z
planGate: pass
implementationGate: pending
planRoundsCompleted: 2
implementationRoundsCompleted: 0
---
# Review Report — Issue #30

## Summary

Plan review **pass** after 2 round(s). Implementation review not yet completed.

## Plan review

| Round | Artifact | Gate status | Findings |
|-------|----------|-------------|----------|
| 1 | `docs/issueflow/reviews/...-plan-review-round-1.md` | pass_with_findings | 3 |

### Round 1 — pass_with_findings

(linked artifact path; first heading or verdict line excerpt)

## Implementation review

_Not started._
```

Rules:

- Regenerated on every `record-review --status pass` (plan or implementation gate).
- Scans `docs/issueflow/reviews/` for `issue-<N>-plan-review-round-*.md` and `issue-<N>-implementation-review-round-*.md`, sorted by round number.
- For each round artifact, extract `## Verdict` line and count `## Findings` sections (or `###` under Findings) when present; fall back to “see artifact” if parse fails.
- When only plan gate has passed, implementation section reads `_Not started._`. When implementation passes, both sections are populated from session + disk.
- `planGate` / `implementationGate` mirror `session.reviewGates` at generation time.

### Session state extension

Add optional nullable fields (zod `.default(null)` for backwards compatibility):

```ts
artifacts: {
  spec: string | null;
  plan: string | null;
  planReview: string | null;
  implementationReview: string | null;
  testReport: string | null;    // new
  reviewReport: string | null;  // new
}
```

`writeTestReport` / `writeReviewReport` update session via injected `updateSessionArtifacts` helper (same `getIssueflowPath` pattern as `writeSessionState`).

### CLI

```
issueflow reports show [--issue <number>] [--json]
```

Resolution order for issue number: `--issue` → `session.json` → branch name (reuse `resolveIssueNumber`).

Output:

- Human: paths + one-line summary per report (`test: pass, 3/3 checks` / `review: plan pass, implementation pending`).
- `--json`: `{ issueNumber, testReport: { path, ...frontmatter }, reviewReport: { path, ...frontmatter } | null }`
- Exit `2` if issue cannot be resolved; exit `0` even when reports are missing (prints `not generated yet`).

### verify hook

After `createVerifyPlan` returns `mode: 'completed'`:

1. `writeTestReport({ repoRoot, run })` → path
2. `updateSessionArtifact(repoRoot, { testReport: path })`
3. Existing stdout summary unchanged

Report write failures are logged to stderr but do **not** change verify exit code.

### review-loop hook

In `record-review`, after a successful `pass` write to session:

1. Import/run `writeReviewReportFromSession(repoRoot)` (via `write-review-report.mjs` subprocess or shared module compiled to dist — plan will use a `.mjs` helper importing from `dist/reports/` or duplicate-minimal logic; prefer importing built `dist` entry or a dedicated `scripts/` module tested alongside).

2. Set `session.artifacts.reviewReport` to the written path.

`pass_with_findings` and `block` do **not** generate the final review report (gate not passed).

## Error Handling

| Condition | Behavior |
|---|---|
| Reports directory not writable | Log warning; verify/review exit codes unchanged |
| Review artifact missing on disk | Row shows path with note `artifact missing` |
| Session missing when updating artifact | Skip session update; report file still written |
| Malformed review markdown | Include path; findings count `unknown` |

## Testing Strategy

### Unit tests

- **test-report** — builds expected markdown from fixture `VerificationRun`; frontmatter fields; check table rows.
- **review-report** — builds report from fixture session + temp review files; plan-only pass; full pass with both gates.
- **store** — round-trip write/read via temp git repo + `rev-parse --git-path`.
- **artifacts** — `findIssueArtifacts` returns `testReport` / `reviewReport` paths when present.
- **verify-command** — stub `writeTestReport`; assert called on completed run, not on print-only or error.
- **review-loop-script** — on `record-review --status pass`, assert `REVIEW_REPORT.md` exists and session `artifacts.reviewReport` set.
- **reports-command** — show human + JSON output, missing reports, issue resolution.

### Integration

- `tests/integration/reports-command.test.ts` — temp repo, write reports manually, `issueflow reports show --issue N --json` returns paths.

## Backwards Compatibility

- New optional `artifacts` fields default to `null`; existing `session.json` files parse without migration.
- Additive CLI subcommand; no changes to verify flags or review-loop arguments.
- `findIssueArtifacts` return type extended — callers using structural typing receive new fields.

## Recommendation

Option A: hook report generation at `verifyAction` and `record-review --status pass`, persist under `.git/issueflow/reports/issue-<N>/`, expose via session artifacts + `issueflow reports show`. Matches #20 persistence patterns, satisfies all three acceptance criteria, and keeps the workflow engine out of scope for v1.
