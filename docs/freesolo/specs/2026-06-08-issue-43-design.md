# Issue #43 — Automated Pull Request Creation Design

**Issue:** [#43 — Automated Pull Request Creation](https://github.com/robert-gleis/freesolo/issues/43)
**Parent:** #13 — Epic: PR and Integration Management
**Builds on:** #35 (Candidate Branch Creation, merged), #29 (Verification Gate, closed), #20 (Verification Pipeline, merged)
**Status:** Draft, awaiting user review

## Summary

Introduce a `PullRequestCreator` that opens a GitHub pull request from a provenance-tracked **candidate branch** after verification has passed. The PR body is assembled from workflow artifacts: a change summary (from the issue spec), structured test results (from the latest verification run), and review results (from the latest implementation review artifact). Provenance is persisted at `<.git>/freesolo/pull-request.json`. v1 ships the domain module, injectable `gh` runner (for tests), body builder, and `freesolo pr create|show` CLI. No workflow-engine policy wiring in this ticket — downstream automation calls the creator directly.

## Goals

- Create a pull request automatically from the candidate branch head against the configured base branch.
- Generate a PR body containing summary, test results, and review results per acceptance criteria.
- Link the PR back to the originating issue via `Closes #<N>` in the body.
- Refuse PR creation when verification has not passed (implements the PR-blocking slice of #29 at creation time).
- Persist PR provenance (number, URL, branches, issue) for idempotent re-runs.
- Keep `gh` subprocess details injectable so unit tests run without network.

## Non-Goals

- **Workflow engine policy changes.** No `src/workflow/` imports from PR creation in v1.
- **Merge readiness checks (#44).** Branch protection / required checks are out of scope.
- **Auto-push semantics beyond minimal.** v1 pushes the candidate branch when `gh pr create` would otherwise prompt; no fork handling.
- **Plan review artifact in PR body.** Implementation review is the authoritative reviewer artifact for factory output; plan review is excluded unless no implementation review exists (then fall back to plan review).
- **Generating summary via LLM.** Summary is extracted from the spec `## Summary` section with deterministic fallbacks.
- **Closing issues via GitHub API.** Issue linkage is body-only (`Closes #N`); merge-time closure is GitHub's default behavior.

## Considered Options

### A. CLI-first creator in `src/integration/` with artifact-driven body (recommended)

`createPullRequest(input, deps)` validates candidate + verification + review artifacts, builds markdown body, invokes `gh pr create`, writes `pull-request.json`. Mirrors #35's `createCandidateBranch` pattern.

**Pros:** Testable, consistent with epic #13 module layout, callable from scripts and future engine policy.
**Cons:** Callers must invoke explicitly until engine wiring lands.

### B. Workflow engine policy at `verifying → reviewing` transition

**Rejected for v1:** Couples PR creation to engine state machine before CLI contract is proven; harder to test in isolation.

### C. Shell script wrapping `gh pr create --fill`

**Rejected:** Cannot assemble structured test/review sections from JSON artifacts without duplicating logic in bash.

## Architecture

```
src/integration/
  pr-types.ts           # PullRequestRecord, CreatePullRequestInput, PullRequestOutcome, PullRequestError
  pr-body.ts            # buildPullRequestBody(input) — summary, tests table, review embed
  pr-store.ts           # read/write pull-request.json via getFreesoloPath
  pr-creator.ts         # createPullRequest(input, deps) — preconditions, gh create, provenance
  index.ts              # extend barrel

src/commands/
  pr.ts                 # registerPrCommands — create, show

tests/unit/
  pr-body.test.ts
  pr-store.test.ts
  pr-creator.test.ts
  pr-command.test.ts
```

### Domain types

```ts
export type PullRequestErrorCode =
  | 'candidate-not-ready'
  | 'verification-not-passed'
  | 'review-artifact-missing'
  | 'summary-unavailable'
  | 'pr-already-exists'
  | 'gh-error'
  | 'git-error'
  | 'invalid-record';

export interface CreatePullRequestInput {
  repoRoot: string;
  issueNumber: number;
  baseBranch?: string;   // default from candidate record's baseBranch, else 'main'
  dryRun?: boolean;
}

export type PullRequestOutcome =
  | { status: 'created'; prNumber: number; prUrl: string; record: PullRequestRecord }
  | { status: 'already-exists'; prNumber: number; prUrl: string; record: PullRequestRecord }
  | { status: 'dry-run'; title: string; body: string; headBranch: string; baseBranch: string };

export interface PullRequestRecord {
  issueNumber: number;
  issueSlug: string;
  prNumber: number;
  prUrl: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  verificationRunId: string;
  implementationReviewPath: string;
  specPath: string | null;
  createdAt: string;   // ISO-8601 UTC
}
```

### Preconditions (`createPullRequest`)

1. `readCandidateBranchRecord(repoRoot)` exists with `status: 'ready'` and `issueNumber` matches input.
2. `loadLatestRun(repoRoot, issueNumber)` returns a run with `status: 'pass'`.
3. `findIssueArtifacts(repoRoot, issueNumber).implementationReview` is non-null; if null, fall back to `planReview`; if still null, throw `review-artifact-missing`.
4. Spec path from `findIssueArtifacts` used for summary extraction (may be null → fall back to plan goal → issue title from candidate record slug).

### PR title

`Issue #<N>: <TitleCase slug as words>` where slug words come from `issueSlug` with hyphens → spaces, first letter capitalized per word. Example: `candidate-branch-creation` → `Issue #35: Candidate Branch Creation`.

### PR body (`buildPullRequestBody`)

Markdown structure:

```markdown
## Summary

{extracted summary text}

## Test Results

Verification run `{runId}` finished at `{finishedAt}` with status **pass**.

| Check | Status | Duration |
| --- | --- | --- |
| lint | pass | 1.2s |
| ... | ... | ... |

## Review Results

{full contents of implementation review artifact file}

---

Closes #<issueNumber>
```

Summary extraction order:
1. Read spec file; capture text under `## Summary` until next `##` heading.
2. Else read plan file; capture text under `**Goal:**` or `## Summary`.
3. Else one-line fallback: `Automated changes for issue #<N> (<issueSlug>).`

Test table rows from `VerificationRun.checks`: name, status, `durationMs` formatted as seconds with one decimal.

### Creation algorithm

1. Resolve preconditions (throw `PullRequestError` on failure).
2. `headBranch = candidateRecord.branchName`, `baseBranch = input.baseBranch ?? candidateRecord.baseBranch`.
3. If `readPullRequestRecord` exists for same `headBranch` + `issueNumber`, return `already-exists`.
4. Query existing open PR: `gh pr list --head <owner>:<headBranch> --json number,url,state --jq '...'`; if open PR found, write/update provenance and return `already-exists`.
5. If `dryRun`, return `{ status: 'dry-run', title, body, headBranch, baseBranch }`.
6. `git push -u origin <headBranch>` from `repoRoot` (ignore if already up to date; fail on hard errors).
7. `gh pr create --base <base> --head <headBranch> --title <title> --body <body>` (use `--body-file` via temp file if body contains special chars).
8. Parse stdout URL / `gh pr view --json number,url` for metadata.
9. Write `pull-request.json` provenance; return `{ status: 'created', ... }`.

### Provenance storage

Path: `git rev-parse --git-path freesolo/pull-request.json`

One record per issue (latest write wins). Zod-validated on read.

### Gh runner injection

```ts
export type GhCommandRunner = (
  args: string[],
  options: { cwd: string; input?: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface PullRequestCreatorDeps {
  runGh: GhCommandRunner;
  runGit: GitCommandRunner;  // reuse from integrator
  readFile: typeof fs.readFile;
  writeFile: typeof fs.writeFile;
  now?: () => Date;
}
```

Production `runGh` wraps `execa('gh', args, { cwd, reject: false })`.

### CLI

```
freesolo pr create [--issue <N>] [--base <branch>] [--dry-run]
freesolo pr show [--issue <N>]
```

`--issue` resolution order (same as `freesolo verify`):
1. `--issue` flag
2. `session.json` `issueNumber`
3. Current branch `issue/<N>-<slug>`
4. Error exit 2 with clear message

Exit codes:
- `0` — created, already-exists, or dry-run printed
- `1` — precondition failed (candidate not ready, verification failed, missing review)
- `2` — validation / usage error
- `3` — gh/git operational error

`show` prints provenance JSON or exits `2` if none.

## Error Handling

| Condition | Behavior |
|---|---|
| No candidate record | Throw `candidate-not-ready` |
| Candidate `status: 'conflict'` | Throw `candidate-not-ready` |
| No verification run | Throw `verification-not-passed` |
| Latest run `status: 'fail'` | Throw `verification-not-passed` |
| No review artifact | Throw `review-artifact-missing` |
| Provenance parse failure | Throw `invalid-record` |
| `gh pr create` failure | Throw `gh-error` with stderr |
| `git push` failure | Throw `git-error` |

## Testing Strategy

### Unit tests

- **pr-body** — summary extraction from spec/plan/fallback; test results table formatting; `Closes #N` footer; review file embed.
- **pr-store** — round-trip read/write; invalid JSON → `invalid-record`.
- **pr-creator** — inject fake gh/git runners: happy path, verification fail short-circuit, missing candidate, already-exists from provenance, already-exists from `gh pr list`, dry-run no gh create.
- **pr-command** — exit codes, `--issue` resolution, dry-run stdout.

### Isolation

Extend `tests/unit/integration-engine-isolation.test.ts` — no new workflow imports (PR module stays in integration only).

## Future Extensions

- Workflow engine policy hook after verification pass.
- Event log entry `pull_request.created`.
- Optional `--draft` flag.
- Include plan review section when implementation review is absent (v1 already falls back to plan review artifact).

## Recommendation

Option A: artifact-driven PR body builder + injectable `gh` creator in `src/integration/`, provenance at `pull-request.json`, thin `freesolo pr` CLI. Satisfies all three acceptance criteria while enforcing verification gate at creation time without workflow engine coupling.
