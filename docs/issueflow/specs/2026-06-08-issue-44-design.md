# Issue #44 — Merge Readiness Check Design

**Issue:** [#44 — Merge Readiness Check](https://github.com/robert-gleis/issueflow/issues/44)
**Parent:** #13 — Epic: PR and Integration Management
**Builds on:** #43 (Automated Pull Request Creation), #29 (Verification Gate), #35 (Candidate Branch Creation, merged), #24 (Workflow Engine, merged)
**Status:** Draft, awaiting user review

## Summary

Introduce a **Merge Readiness Gate** — the final factory checkpoint before a pull request may be merged. The gate evaluates verification, review, PR provenance, and optional policy checks, persists an authoritative verdict, surfaces the checklist on the PR itself, and blocks `issueflow merge` until every required check passes. Re-running verification or the workflow after a fix invalidates a stale ready verdict and allows the gate to be re-evaluated to `ready` once checks pass again.

v1 ships a pure evaluator, verdict persistence (GitHub labels + local JSON + PR comment), and `issueflow merge evaluate|merge|show` CLI. No workflow-engine policy wiring in this ticket — downstream automation calls the evaluator directly, matching #35 and #43.

## Goals

- Block PR merge when any required gate has not passed.
- Make gate state visible on the PR via a formatted checklist comment (updated in place when possible).
- Allow re-evaluation after fixes: a new failing verification run or workflow rollback invalidates readiness; a subsequent passing run can restore `ready`.
- Record each evaluation as a durable verdict on the issue (GitHub `merge:*` labels + `merge-readiness.json`).
- On successful merge, advance workflow state `pr-ready → merged` (engine-gated).
- Keep `gh` subprocess details injectable so unit tests run without network.

## Non-Goals

- **Branch protection rule configuration.** IssueFlow enforces through `issueflow merge`; bare `gh pr merge` bypass is documented, same pattern as #29 for `gh pr create`.
- **Workflow engine policy changes.** No `src/workflow/` imports from merge readiness in v1.
- **Auto-merge on green.** v1 evaluates and optionally merges when explicitly invoked with `issueflow merge`; no daemon polling.
- **PR creation.** Covered by #43; merge readiness assumes a PR already exists.
- **Running the verification pipeline.** Callers run `issueflow verify` and `issueflow gate evaluate` (#29) before merge evaluate.
- **Human PR review on GitHub.** Out of scope; factory review artifacts are the review gate input.

## Acceptance Criteria Mapping

| Criterion | How this design satisfies it |
|-----------|------------------------------|
| PR is blocked from merging until all gates pass | `issueflow merge` refuses `gh pr merge` unless `evaluateMergeReadiness` returns `outcome: 'ready'`. Exit `1` with per-check failure reasons. |
| Gate state is visible on the PR | `merge evaluate` posts or updates a PR comment with a markdown checklist table (check name, status, detail). Issue also carries `merge:ready` or `merge:blocked` label. |
| Re-running the workflow can re-open the gate after a fix | Evaluator compares verdict `verificationRunId` against latest run; stale pass → `blocked`. After fix + new verify + gate evaluate, `merge evaluate` can return `ready` again. `merge:blocked` label replaces `merge:ready`. |

## Considered Options

### A. Evaluator + CLI merge command with PR comment visibility (recommended)

`evaluateMergeReadiness(input)` runs a fixed checklist of gates. `issueflow merge evaluate` writes verdict, swaps labels, syncs PR comment. `issueflow merge` merges only when ready.

**Pros:** Testable, consistent with #29/#43 module layout, PR-visible without GitHub Apps/check-run APIs.
**Cons:** Callers must invoke explicitly until engine wiring lands.

### B. GitHub Check Run (`issueflow/merge-readiness`)

Create a required status check via Checks API.

**Rejected for v1:** Requires more GitHub API surface, token scopes, and repo configuration; IssueFlow's CLI-first pattern favours comments + labels first.

### C. Engine policy sensor at `pr-ready`

Policy polls PR mergeable state every tick.

**Rejected for v1:** Couples merge readiness to engine tick timing before CLI contract is proven (#24 explicitly deferred this to a future ticket).

## Architecture

```
src/integration/
  merge-types.ts           # MergeReadinessRecord, MergeGateCheck, MergeReadinessOutcome
  merge-readiness.ts       # evaluateMergeReadiness(input) — pure checklist
  merge-store.ts             # read/write merge-readiness.json, label helpers
  merge-comment.ts           # buildMergeReadinessComment(checks) — PR markdown
  merge-executor.ts          # evaluateAndPersist, syncPrComment, executeMerge
  index.ts                   # extend barrel

src/commands/
  merge.ts                   # registerMergeCommands — evaluate, merge, show

tests/unit/
  merge-readiness.test.ts
  merge-store.test.ts
  merge-comment.test.ts
  merge-executor.test.ts
  merge-command.test.ts
```

### Gate checklist (v1)

Each gate is a `MergeGateCheck`:

```ts
export interface MergeGateCheck {
  id: string;
  label: string;
  status: 'pass' | 'fail' | 'skip';
  detail: string;
}

export type MergeReadinessOutcome = 'ready' | 'blocked';

export interface MergeReadinessEvaluation {
  outcome: MergeReadinessOutcome;
  checks: MergeGateCheck[];
  reason: string;       // one-line summary
  nextAction: string;   // operator guidance when blocked
}
```

Fixed gates evaluated in order:

| Gate id | Pass condition |
|---------|----------------|
| `workflow-state` | GitHub workflow state is `pr-ready` |
| `verification-run` | `loadLatestRun` exists with `status === 'pass'` |
| `verification-verdict` | `readVerdict` (#29) returns `pass` and `runId` matches latest run |
| `review-artifact` | `findIssueArtifacts(...).implementationReview` is non-null; if absent, fall back to `planReview`; if still absent → fail |
| `pull-request` | `readPullRequestRecord` (#43) exists; `gh pr view <number> --json state` is `OPEN` |
| `candidate-branch` | `readCandidateBranchRecord` has `status: 'ready'` (optional skip when no candidate record and PR head matches an `issue/<N>-*` branch) |

Policy extension (v1 minimal): read optional `.issueflow/merge-policy.json`:

```json
{
  "mergePolicy": {
    "requireCandidateBranch": true,
    "requireImplementationReview": true
  }
}
```

Defaults: `requireCandidateBranch: true`, `requireImplementationReview: true`. When `requireImplementationReview` is false, `review-artifact` gate passes if either review artifact exists.

### Pure evaluator

```ts
export interface MergeReadinessInput {
  state: WorkflowState | null;
  verdict: VerdictStatus | null;
  verdictRunId: string | null;
  latestRun: VerificationRun | null;
  artifacts: IssueArtifactPaths;
  pullRequest: PullRequestRecord | null;
  prState: 'OPEN' | 'CLOSED' | 'MERGED' | null;
  candidateRecord: CandidateBranchRecord | null;
  policy?: MergePolicyConfig;
}

export function evaluateMergeReadiness(input: MergeReadinessInput): MergeReadinessEvaluation;
```

Rules:
- `outcome === 'ready'` only when every non-skipped check has `status: 'pass'`.
- Stale verification: if verdict `runId` ≠ latest run `runId`, `verification-verdict` fails with detail "Stale verdict — re-run `issueflow gate evaluate`."
- `nextAction` when blocked lists the first failing gate's remediation (e.g. "Run `issueflow verify` then `issueflow gate evaluate` then `issueflow merge evaluate`.")

### Verdict persistence

#### GitHub labels

Prefix: `merge:`. Exactly one merge-readiness label per issue.

- `merge:ready` — colour `1D76DB` (blue)
- `merge:blocked` — colour `D93F0B` (orange)

`writeMergeVerdict` swaps labels atomically via single `gh issue edit` (same pattern as #29 `writeVerdict`).

#### Local record

Path: `git rev-parse --git-path issueflow/merge-readiness.json`

```ts
interface MergeReadinessRecord {
  schemaVersion: 1;
  issueNumber: number;
  outcome: MergeReadinessOutcome;
  checks: MergeGateCheck[];
  verificationRunId: string | null;
  pullRequestNumber: number | null;
  prCommentId: string | null;   // for in-place comment updates
  reason: string;
  nextAction: string;
  evaluatedAt: string;          // ISO-8601 UTC
}
```

Written on every `merge evaluate` (both ready and blocked).

### PR visibility

`buildMergeReadinessComment(evaluation, issueNumber)` produces:

```markdown
## IssueFlow Merge Readiness

**Verdict:** ready | blocked
**Evaluated:** 2026-06-08T12:00:00.000Z

| Gate | Status | Detail |
| --- | --- | --- |
| Workflow state | pass | pr-ready |
| Verification run | pass | run 2026-06-08T... |
| ... | ... | ... |

<!-- issueflow-merge-readiness -->
```

The HTML comment marker lets `merge evaluate` find and update the existing comment via `gh api` or `gh pr comment --edit-last` fallback (create new if not found).

### Merge execution

`issueflow merge [--issue <N>] [--merge-method squash|merge|rebase]`:

1. Load latest `merge-readiness.json`; if `outcome !== 'ready'`, re-run evaluation inline.
2. If still blocked → exit `1`, print `nextAction`.
3. Engine-gated (`ISSUEFLOW_ENGINE=1`): `writeState(..., 'pr-ready', 'merged')` **after** successful `gh pr merge` (not before — merge can fail).
4. `gh pr merge <number> --<method>` with injectable runner.
5. On success: update record with `mergedAt`, print summary.

Re-open semantics: if an operator moves state back to `implementing` and verification fails, the next `merge evaluate` writes `blocked` and updates the PR comment. After fix cycle completes (`verifying → pr-ready`), `merge evaluate` can return `ready` again.

### Gh runner injection

```ts
export interface MergeExecutorDeps {
  runGh: GhCommandRunner;
  readState: ...;
  writeState: ...;
  loadLatestRun: ...;
  readVerdict: ...;
  readGateVerdictRecord: ...;
  findIssueArtifacts: ...;
  readPullRequestRecord: ...;
  readCandidateBranchRecord: ...;
  readMergeReadinessRecord: ...;
  writeMergeReadinessRecord: ...;
  writeMergeVerdict: ...;
  now?: () => Date;
}
```

## CLI Surface

```
issueflow merge evaluate [--issue <N>] [--print-only]
issueflow merge [--issue <N>] [--merge-method <m>]
issueflow merge show [--issue <N>]
```

`--issue` resolution: same order as `issueflow verify` (flag → session → branch).

Exit codes (`evaluate`):
- `0` — ready
- `1` — blocked
- `2` — validation error (no PR, no issue)
- `3` — gh operational error
- `4` — malformed labels (operator repair)

Exit codes (`merge`):
- `0` — merged successfully
- `1` — blocked or merge failed
- `2` — validation error
- `3` — not engine-gated when state transition needed

`--print-only` on evaluate: print checklist table to stdout without writing labels, JSON, or PR comment.

## Error Handling

| Situation | Exit | Side effects |
|-----------|------|--------------|
| No pull request record | `2` | none |
| PR not OPEN | `1` (blocked) | verdict blocked, comment updated |
| Stale verification | `1` | blocked, nextAction names gate evaluate |
| All gates pass | `0` | `merge:ready`, JSON written, comment updated |
| `gh pr merge` fails | `1` | state unchanged |
| Merge succeeds | `0` | state → merged, record updated |

## Testing Strategy

### Unit tests

- **merge-readiness** — each gate pass/fail/stale paths; policy toggles; `outcome` aggregation.
- **merge-comment** — markdown table formatting; marker present.
- **merge-store** — JSON roundtrip; label swap with fake `gh`.
- **merge-executor** — inject deps: evaluate persists, comment sync, merge blocked vs allowed, state transition only after gh success.
- **merge-command** — CLI exit codes, `--print-only`, issue resolution.

### Integration test

`tests/integration/merge-command.test.ts` — temp repo with fake `gh`: full path verify → gate evaluate → pr create → merge evaluate (ready) → merge succeeds; failing verification blocks merge; re-evaluate after new pass restores ready.

### Isolation

Extend `tests/unit/integration-engine-isolation.test.ts` — merge module stays in `src/integration/`; workflow engine does not import it in v1.

## Dependency Assumptions

Implementation merges or rebases onto branches containing:
- #29: `src/verification/gate.ts`, `verdict-store.ts`, `issueflow gate evaluate`
- #43: `src/integration/pr-*.ts`, `pull-request.json`, `issueflow pr create|show`

If those modules are absent, stub interfaces are not acceptable for merge — the implementation branch must include dependency code first.

## Future Extensions

- Workflow engine policy hook: `pr-ready` tick calls merge evaluate; auto-merge when ready.
- Event log entries `merge.blocked`, `merge.ready`, `merge.completed`.
- GitHub Check Run integration for repos that want required checks.
- Richer policy gates (required labels, CODEOWNERS approval proxy).

## Recommendation

Option A: pure evaluator + verdict persistence + PR comment sync + `issueflow merge` CLI in `src/integration/`, following the #29 verdict-label pattern and #43 provenance pattern. Satisfies all three acceptance criteria with testable, injectable boundaries and explicit re-open semantics via stale-run detection.
