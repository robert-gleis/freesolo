# Issue #35 — Candidate Branch Creation Design

**Issue:** [#35 — Candidate Branch Creation](https://github.com/robert-gleis/issueflow/issues/35)
**Parent:** #13 — Epic: PR and Integration Management
**Builds on:** #19 (Worktree Manager, merged), #28 (Worktree Metadata Tracking, merged)
**Status:** Draft, awaiting user review

## Summary

Introduce a `CandidateBranchIntegrator` that merges one or more team/agent worktree branch heads into a single **candidate branch** ready for verification and PR. The integrator never auto-resolves merge conflicts — it aborts the in-progress merge, returns a structured conflict report naming the offending source branch and conflicted files, and leaves the repository in a clean state. Provenance tying the candidate branch to its source issue and team is persisted at `<.git>/issueflow/candidate-branch.json`.

v1 ships the domain module, a git-backed implementation with injectable subprocess runner (for tests), provenance read/write helpers, and an `issueflow candidate create` CLI subcommand. No workflow-engine wiring in this ticket — downstream automation (#43, #44) will call the integrator directly.

## Goals

- Merge multiple source branches (team/agent worktree results) into one candidate branch when they integrate cleanly.
- Surface merge conflicts to callers as structured data (`status: 'conflict'`) without silently resolving or committing partial merges.
- Persist provenance linking `branchName`, `issueNumber`, `teamId`, and the list of `sources` (branch + owner metadata).
- Expose `issueflow candidate create` for manual and scripted invocation.
- Keep git subprocess details injectable so unit tests run without a real merge graph.

## Non-Goals

- **Automated PR creation (#43).** Candidate branch must exist first; PR automation is a separate ticket.
- **Merge readiness checks (#44).** Verification gating is out of scope.
- **Team Lifecycle Manager wiring (#41).** v1 accepts an explicit `--branches` list; auto-discovering branches from `WorktreeManager` is a follow-up once team lifecycle lands.
- **Workflow engine policy changes.** No `src/workflow/` imports from `src/integration/` in v1.
- **Conflict resolution strategies.** No ours/theirs, no merge drivers, no AI resolution — conflicts are fatal to the integration attempt.
- **Cross-repo merges.** All branches must exist in the repo identified by `repoRoot`.
- **Rewriting existing candidate branches.** If provenance already records a successful candidate for the issue, `create` returns `already-exists` (idempotent) unless `--force` is passed (which deletes the old branch and provenance before retrying).

## Considered Options

### A. Sequential `git merge --no-commit` with abort-on-conflict (recommended)

Create `candidate/<issueNumber>-<slug>` from `baseBranch` (default `main`). For each source branch in caller-supplied order, run `git merge --no-commit --no-ff <source>`. On first conflict, run `git merge --abort`, capture `git diff --name-only --diff-filter=U`, return `{ status: 'conflict', conflictingBranch, conflictedFiles }`. On full success, commit once with a message referencing issue and team.

**Pros:** Uses standard git semantics; conflict detection is reliable; repo stays clean after abort.
**Cons:** Requires repo to be on candidate branch during operation (documented constraint).

### B. `git merge-tree` / plumbing-only merge without checkout

**Rejected for v1:** Harder to test consistently across git versions; does not produce a real candidate branch ref without additional steps.

### C. Squash each source via cherry-pick

**Rejected:** Loses merge topology; conflicts are harder to attribute to a specific source branch when histories diverged significantly.

## Architecture

```
src/integration/
  types.ts              # CandidateBranchSource, CreateCandidateBranchInput, CandidateBranchOutcome, CandidateBranchRecord
  naming.ts             # buildCandidateBranchName(issueNumber, slug) → 'candidate/35-candidate-branch-creation'
  integrator.ts         # createCandidateBranch(input, deps) — core merge loop
  store.ts              # readCandidateBranchRecord / writeCandidateBranchRecord via getIssueflowPath
  index.ts              # barrel

src/commands/
  candidate.ts          # registerCandidateCommands — create, show

tests/unit/
  candidate-branch-naming.test.ts
  candidate-branch-integrator.test.ts
  candidate-branch-store.test.ts
  candidate-command.test.ts
```

Why `src/integration/`:

- Epic #13 is "PR and Integration Management"; future tickets (#43 PR creation, #44 merge readiness) share this namespace.
- Mirrors `src/planner/`, `src/verification/` — domain logic outside CLI wiring.
- Engine and future Team Lifecycle Manager import from `src/integration/index.ts` without pulling Commander.

### Domain types

```ts
export interface CandidateBranchSource {
  branchName: string;
  ownerKind: 'agent' | 'team';
  ownerId: string;
}

export interface CreateCandidateBranchInput {
  repoRoot: string;
  issueNumber: number;
  issueSlug: string;
  teamId: string;
  sources: CandidateBranchSource[];
  baseBranch?: string;   // default 'main'
  force?: boolean;       // replace existing successful candidate
}

export type CandidateBranchOutcome =
  | { status: 'created'; branchName: string; mergeCommitSha: string; record: CandidateBranchRecord }
  | {
      status: 'conflict';
      branchName: string;
      conflictingBranch: string;
      conflictedFiles: string[];
      gitOutput: string;
      record: CandidateBranchRecord;  // status 'conflict', no mergeCommitSha
    }
  | { status: 'already-exists'; branchName: string; record: CandidateBranchRecord };

export interface CandidateBranchRecord {
  branchName: string;
  issueNumber: number;
  issueSlug: string;
  teamId: string;
  sources: CandidateBranchSource[];
  baseBranch: string;
  mergeCommitSha: string | null;
  status: 'ready' | 'conflict';
  createdAt: string;   // ISO-8601 UTC
  updatedAt: string;
}
```

### Branch naming

`buildCandidateBranchName(issueNumber, slug)` → `candidate/<issueNumber>-<slug>`

Distinct from worktree branches (`issue/<number>-<slug>`) so operators can list candidate refs unambiguously.

### Merge algorithm (`createCandidateBranch`)

1. Validate `sources.length >= 1`; each `branchName` must be resolvable via `git rev-parse --verify refs/heads/<branch>`.
2. Resolve `branchName = buildCandidateBranchName(issueNumber, issueSlug)`.
3. If provenance exists with `status: 'ready'` and `!force`, return `already-exists`.
4. If `force` and branch exists, `git branch -D branchName` (ignore if missing) and clear provenance.
5. `git fetch` is **not** called — operates on local refs only (caller's responsibility to have up-to-date branches).
6. `git checkout -B branchName baseBranch` from `repoRoot`.
7. For each `source` in order:
   - `git merge --no-commit --no-ff source.branchName`
   - On non-zero exit or unmerged index entries:
     - `git merge --abort`
     - Write provenance with `status: 'conflict'`, `mergeCommitSha: null`
     - Return `{ status: 'conflict', conflictingBranch: source.branchName, conflictedFiles, gitOutput }`
8. `git commit -m "candidate: integrate team <teamId> for issue #<issueNumber>"`
9. Write provenance with `status: 'ready'`, `mergeCommitSha` from `git rev-parse HEAD`.
10. Return `{ status: 'created', branchName, mergeCommitSha, record }`.

**Invariants:**
- Never leave the repo mid-merge (always abort on failure).
- Never write `status: 'ready'` provenance unless the commit succeeded.
- Conflict path still writes provenance so the workflow can inspect the failed attempt.

### Provenance storage

Path: `git rev-parse --git-path issueflow/candidate-branch.json`

Uses the same `getIssueflowPath` pattern as `session.json` and `team-plan.json`. JSON validated with Zod on read. One record per issue worktree (latest write wins).

### Git runner injection

```ts
export type GitCommandRunner = (
  args: string[],
  options: { cwd: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface CandidateBranchIntegratorDeps {
  runGit: GitCommandRunner;
  now?: () => Date;
}
```

Production default wraps `execa('git', args, { cwd, reject: false })`. Tests inject a scriptable fake that simulates clean merges and conflicts.

### CLI

```
issueflow candidate create --issue <N> --team <teamId> --branches <b1,b2,...> [--base main] [--force]
issueflow candidate show --issue <N>
```

`create` resolves `issueSlug` from the issue packet in the current worktree's `current-issue.md` or from `git rev-parse` issueflow metadata when available; if missing, derives slug from branch name `issue/<N>-<slug>` on the current branch.

Exit codes:
- `0` — created or already-exists
- `1` — conflict (prints JSON conflict report to stderr)
- `2` — validation error (missing branches, bad flags)
- `3` — git operational error

`show` prints the provenance JSON or exits `2` if none.

## Error Handling

| Condition | Behavior |
|---|---|
| Zero sources | Throw `CandidateBranchError` code `no-sources` before touching git |
| Branch not found | Throw `branch-not-found` naming the missing ref |
| Git command unexpected failure | Throw `git-error` with captured stderr |
| Conflict | Return outcome `conflict` (not thrown) — workflow inspects structured result |
| Provenance parse failure | Throw `invalid-record` |

## Testing Strategy

### Unit tests

- **naming** — `buildCandidateBranchName` formatting.
- **integrator** — fake git runner scenarios: clean two-branch merge, conflict on second branch (assert abort called, provenance status conflict), already-exists short-circuit, force recreate.
- **store** — round-trip read/write via temp git repo + `rev-parse --git-path`.
- **command** — inject integrator deps; assert exit codes and stdout/stderr for create/show.

### Isolation

Add `tests/unit/integration-engine-isolation.test.ts` asserting `src/workflow/engine.ts` does not import `src/integration/` (same pattern as worktree/planner isolation guards).

## Future Extensions

- Auto-collect source branches from `WorktreeManager.list()` filtered by `issueNumber` + `teamId`.
- Hook into workflow engine policy at `reviewing → verifying` transition.
- Event log entry `candidate.created` / `candidate.conflict`.
- Integration with #43 to open PR from candidate branch head.

## Recommendation

Option A (sequential merge with abort-on-conflict) in a new `src/integration/` module, provenance at `candidate-branch.json`, and a thin CLI. Matches the contract-plus-implementation pattern established by #19, #28, and #34 while satisfying all three acceptance criteria.
