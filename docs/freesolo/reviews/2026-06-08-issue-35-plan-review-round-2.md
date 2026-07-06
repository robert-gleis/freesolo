# Plan Review Round 2 — Issue #35

## Verdict
pass_with_findings

## Findings

1. **minor — Slug fallback order inverts the spec CLI contract (plan: Task 5 Step 1; spec: CLI → `create`).** The spec lists `current-issue.md` first, then freesolo metadata (`session.json` via `git rev-parse --git-path`), then branch derivation. Task 5 tests encode `session.json` → `current-issue.md` → branch. Round 1 recommended the spec order; the updated plan flipped it. Reorder `resolveIssueSlug` tests and implementation to match the spec (or document an intentional deviation in the plan if `session.json` is preferred).

2. **minor — `--base` and `--force` lack CLI-level tests despite round 1 fix (plan: Task 5; spec: CLI).** Both flags now appear in the Step 3 command definition and integrator force logic is covered in Task 4, but Step 1 exit-code tests do not assert `--base` is forwarded to `CreateCandidateBranchInput.baseBranch` or that `--force` triggers recreate after `already-exists`. Add two CLI harness cases mirroring `plan-command.test.ts` so the user-facing entry points stay wired.

3. **minor — Integrator `git-error` throw path still untasked (plan: Tasks 3–4; spec: Error Handling).** Round 1 finding #4 is partially addressed: `no-sources` and `branch-not-found` are in Task 3, `invalid-record` in Task 2. Task 5 covers exit code `3` at the CLI layer, but no integrator fake-git scenario asserts an unexpected non-zero git exit (e.g. checkout failure) maps to `CandidateBranchError` code `git-error`. Add one integrator test so the error table is fully covered at the domain layer, not only via CLI indirection.

## Round 1 remediation summary

| Round 1 # | Severity | Status |
|---|---|---|
| 1 issueSlug resolution | major | **Resolved** — `resolveIssueSlug`, tests, and `createAction` wiring in Task 5 |
| 2 `--base` / `--force` flags | major | **Mostly resolved** — flags in CLI Step 3; CLI tests still missing (finding #2 above) |
| 3 CLI exit-code coverage | major | **Resolved** — Task 5 Step 1 lists 0/1/2/3 and show-missing-record |
| 4 Integrator error scenarios | major | **Mostly resolved** — `no-sources`, `branch-not-found`, `invalid-record`; `git-error` integrator test still missing (finding #3 above) |
| 5 Conflict outcome fields | major | **Resolved** — Task 4 asserts `conflictedFiles`, `gitOutput`, abort-before-provenance |
| 6 Engine isolation pattern | major | **Resolved** — Task 6 uses `listTsFiles` + regex matching planner precedent |
| 7 Store `invalid-record` | minor | **Resolved** — Task 2 malformed-JSON test |
| 8 Store absolute-path join | minor | **Resolved** — `getCandidateBranchPath` mirrors `getTeamPlanPath` |
| 9 `cli.test.ts` smoke test | minor | **Resolved** — File Structure + Task 5 Step 5 |
| 10 Production `defaultRunGit` | minor | **Resolved** — Task 3 exports `defaultRunGit`; Task 5 wires `defaultDeps` |
| 11 `branch-not-found` pre-merge | minor | **Resolved** — Task 3 algorithm step 2 + test |
| 12 Force provenance clear | minor | **Resolved** — Task 4 "clear provenance" in tests and implementation |

## Spec alignment (spot-check)

| Spec area | Plan coverage | Notes |
|---|---|---|
| Module layout (`src/integration/`, CLI, tests) | Tasks 1–6 | Matches spec architecture |
| Domain types and outcomes | Task 1 | `CandidateBranchError` codes align with error table |
| Merge algorithm (sequential merge, abort, no fetch) | Tasks 3–4 | Adequate; `git fetch` omission is acceptable (negative requirement) |
| Provenance store (`candidate-branch.json`, Zod) | Task 2 | Matches `getFreesoloPath` pattern |
| Idempotency / force | Task 4 | `already-exists` on ready record; force clears provenance |
| CLI `create` / `show` + exit codes | Task 5 | Complete except slug order (#1) and `--base`/`--force` CLI tests (#2) |
| Workflow isolation guard | Task 6 | Matches spec testing strategy |
| Acceptance criteria (merge, conflict surfacing, provenance) | Tasks 2–5 | Covered at integrator + CLI level |

## What looks good

- Round 1 drove substantive fixes: slug resolution, exit-code matrix, conflict field assertions, isolation regex, store hardening, and `defaultRunGit` are all now explicit.
- TDD task structure, file layout, and verification checklist remain clear and implementable.
- Injectable `runGit`, conflict-as-outcome (not thrown), and provenance on conflict path match the spec domain model.
