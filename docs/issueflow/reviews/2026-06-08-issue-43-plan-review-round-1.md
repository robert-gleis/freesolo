# Plan Review Round 1 — Issue #43

## Verdict

pass_with_findings

## Findings

### Major

**1. Isolation guard extension absent from plan**

The spec explicitly states: "Extend `tests/unit/integration-engine-isolation.test.ts` — no new workflow imports (PR module stays in integration only)." No plan task or step covers this. The existing test (added in #35) already guards all `src/workflow/**` imports against the integration module, so new `src/integration/pr-*.ts` files are passively covered. However, the spec intent is to add a step that *confirms* coverage is still passing after the PR files land — the conventional final "run full suite" step in Task 7 is insufficient as an explicit call-out. Add a bullet to Task 7 or a dedicated step citing `integration-engine-isolation.test.ts` by name.

**2. `--issue` optionality not signalled to implementer**

The spec defines `issueflow pr create [--issue <N>]` as optional (brackets, same resolution chain as `issueflow verify`). The plan Task 6 Step 3 says "Reuse `resolveRepoRoot`, `getIssueflowPath`, branch pattern from `candidate.ts` / `verify.ts`" without flagging that `candidate.ts` declares `--issue` as `.requiredOption(...)`. An implementer copying `candidate.ts` top-to-bottom will make `--issue` required, breaking the spec's auto-resolution fallback. The plan must explicitly say: use `.option` (not `.requiredOption`) for `--issue`, and delegate to `resolveIssueNumber(repoRoot, options.issue)` from `src/core/issue-id.ts` (which already implements the exact 3-step fallback the spec requires).

**3. `GhCommandRunner` and `PullRequestCreatorDeps` missing from Task 1 code block**

Task 1 Step 3 provides a copy-pasteable `pr-types.ts` scaffold. It includes `PullRequestErrorCode`, `CreatePullRequestInput`, `PullRequestRecord`, and `PullRequestOutcome` — matching the spec — but omits `GhCommandRunner` and `PullRequestCreatorDeps`. Both are spec-required, referenced in Task 4 and Task 5, and must be in `pr-types.ts` (or `pr-creator.ts`). The implementer must re-consult the spec mid-task to discover them. At minimum, Task 1 Step 3 should include the stubs or note the file they belong in.

### Minor

**4. `GitCommandRunner` import source unspecified**

`PullRequestCreatorDeps` requires `runGit: GitCommandRunner` with the note "reuse from integrator". The plan never says to import `GitCommandRunner` from `./integrator.js` (or re-export it via `src/integration/index.ts`). An implementer may define a new identical type in `pr-types.ts`, creating a structural duplicate that passes TypeScript but diverges from the canonical definition. Add one line in Task 1 Step 3: "Re-export `GitCommandRunner` from `./integrator.js`; do not redeclare."

**5. Task 6 Step 4 unclosed markdown bold**

```
- [ ] **Step 4: Register in `src/cli.ts` via `registerPrCommands(program)`
```

Missing closing `**`. Renders as literal asterisks in rendered markdown. Fix: add `**` after the closing backtick.

**6. Temp file cleanup for `--body-file` not mentioned**

Task 5 Step 3 says "Write body to temp file; `gh pr create ... --body-file ...`" but does not say to delete the temp file after `gh` returns (success or failure). The OS `tmp` dir is writable by others in shared environments; a stale body file containing the full PR body (including review text) is a minor information-leak risk. Recommend adding a `finally` cleanup, and noting it in the step.

**7. `findIssueArtifacts` import source never stated**

`findIssueArtifacts` is used in `createPullRequest` for precondition 3 and for resolving spec/plan paths, but the plan never mentions it lives in `src/core/artifacts.ts`. The file structure table lists only new `src/integration/pr-*.ts` files; `artifacts.ts` is a pre-existing core utility. Add to Task 4 Step 3: "Import `findIssueArtifacts` from `../core/artifacts.js`."

**8. `implementationReviewPath` semantically misnamed in fallback case**

`PullRequestRecord.implementationReviewPath: string` is the provenance field for the review file embedded in the PR body. When the fallback to `planReview` is used (no implementation review present), the stored path is actually a plan review file path — the field name is misleading. The spec introduces this inconsistency but the plan does not note it or suggest a mitigation (e.g., rename to `reviewArtifactPath`, or store `reviewKind: 'implementation' | 'plan'` alongside). An implementer might store `null` in the field instead of the fallback path, breaking later `pr show` output. The plan should add a note clarifying what to write when the fallback is taken.

## Notes

The plan is structurally sound: TDD checkpoints are present throughout, the file structure matches the spec's architecture section, `createPullRequest` algorithm steps map cleanly to Tasks 4 and 5, exit codes are enumerated, and the Task 7 full-suite gate is correct. The #35 parallel structure is well maintained. Findings 1–3 are the only items that could cause a silently incorrect implementation; the rest are polish.
