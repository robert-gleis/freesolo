# Implementation Review Round 1 — Issue #35

## Verdict
pass_with_findings

## Findings

### 🟡 Suggestion — Multi-source conflict may leave partial staged merges (`src/integration/integrator.ts`)

When a conflict occurs on the second (or later) source branch, the integrator calls `git merge --abort`, which only rolls back the *failing* merge. Earlier successful `git merge --no-commit --no-ff` calls leave their staged changes in the index on the candidate branch. The spec summary promises the repo is left in a "clean state" after abort, and the invariant says "Never leave the repo mid-merge." In practice, a conflict on source B can leave source A's changes staged but uncommitted on `candidate/<issue>-<slug>`.

**Impact:** Operators or downstream automation inspecting the candidate branch after a conflict may see misleading partial integration. Retries are safe because `create` always runs `checkout -B` first, but the failed attempt itself is not fully reset.

**Recommendation:** After `merge --abort` on conflict, reset the candidate branch to `baseBranch` (e.g. `git reset --hard` or re-run `checkout -B`) before writing conflict provenance.

---

### 🟡 Suggestion — Conflict detection relies solely on merge exit code (`src/integration/integrator.ts:118`)

The spec's merge algorithm step 7 says to detect conflict on "non-zero exit **or unmerged index entries**." The implementation only checks `merge.exitCode !== 0`. Git normally returns non-zero on conflict, but the unmerged-index guard is absent.

**Impact:** Low probability of a false `created` outcome if git reports success with lingering unmerged paths.

**Recommendation:** After each merge, also run `git diff --name-only --diff-filter=U` (or `git ls-files -u`) and treat non-empty output as conflict even when exit code is 0.

---

### 🟡 Suggestion — `merge --abort` success is not verified (`src/integration/integrator.ts:120`)

`merge --abort` is invoked on conflict but its exit code is ignored. If abort fails, the repo can remain mid-merge despite returning a structured conflict outcome.

**Impact:** Violates the "never leave the repo mid-merge" invariant in edge cases (corrupt index, concurrent git operations).

**Recommendation:** Assert abort success; on failure throw `git-error` or attempt a hard reset to `baseBranch`.

---

### 🟢 Nice-to-have — Slug resolution failure uses `invalid-record` error code (`src/commands/candidate.ts:91-94`)

`resolveIssueSlug` throws `CandidateBranchError` with code `invalid-record` when no slug source is found. Semantically this is a validation/resolution failure, not a malformed provenance record. CLI behavior is correct (exit 2), but programmatic callers may misinterpret the code.

**Recommendation:** Add a dedicated code (e.g. `slug-not-found`) or reuse a generic validation code in a follow-up.

---

### 🟢 Nice-to-have — No real-git integrator test (`tests/unit/candidate-branch-integrator.test.ts`)

All integrator scenarios use a scriptable fake `runGit`. This matches the plan and keeps tests fast, but acceptance criterion #1 ("worktree results merge cleanly into candidate branch") is validated only against simulated git responses, not an actual two-branch merge graph.

**Recommendation:** Optional follow-up integration test with a temp repo, two feature branches, and a real merge — not required for v1 per spec.

---

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| 1. Worktree results merge cleanly into candidate branch | **Met** | Sequential `--no-commit --no-ff` merges, single commit on success, provenance `status: 'ready'` with `mergeCommitSha`. Tested in `candidate-branch-integrator.test.ts` (clean two-source merge). |
| 2. Conflicts surfaced to workflow, not silently resolved | **Met** | Returns `{ status: 'conflict', conflictingBranch, conflictedFiles, gitOutput, record }`; calls `merge --abort`; writes provenance `status: 'conflict'`; CLI exits 1 with JSON on stderr. No auto-resolution or partial commit. |
| 3. Candidate branch tied to issue and team | **Met** | `buildCandidateBranchName(issueNumber, slug)`; provenance stores `issueNumber`, `issueSlug`, `teamId`, `sources[]` with owner metadata; CLI requires `--issue` and `--team`. |

## Plan & Spec Alignment

| Area | Status |
|---|---|
| `src/integration/` module (types, naming, store, integrator, barrel) | Complete |
| Zod-validated provenance at `candidate-branch.json` via `getIssueflowPath` | Complete |
| Injectable `runGit` / `defaultRunGit` | Complete |
| `issueflow candidate create\|show` CLI + `cli.ts` registration | Complete |
| Exit codes 0/1/2/3 per spec | Complete |
| Slug resolution order: `current-issue.md` → `session.json` → branch | Complete |
| `already-exists` short-circuit, `--force` recreate | Complete |
| Engine isolation guard (`integration-engine-isolation.test.ts`) | Complete |
| Unit test coverage per plan tasks 1–6 | Complete |

## Verification

- `npm run build` — **pass**
- Issue #35 tests (naming, store, integrator, command, isolation, cli smoke) — **all pass** (22 tests)
- Full suite has 2 pre-existing unrelated failures (`local-process-runner`, `verify-command` integration)

## Summary

Implementation faithfully delivers the planned `CandidateBranchIntegrator`, provenance store, and CLI. All three acceptance criteria are functionally satisfied. Findings are edge-case hardening around multi-source conflict cleanup and defensive conflict detection — none block v1 ship, but the partial-staged-index behavior on multi-source conflict is the highest-priority follow-up.
