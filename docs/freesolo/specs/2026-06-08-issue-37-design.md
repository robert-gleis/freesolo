# Issue #37 — Automatic Issue Decomposition Design

**Issue:** [#37 — Automatic Issue Decomposition](https://github.com/robert-gleis/freesolo/issues/37)
**Parent:** #16 — Epic: Autonomous Execution
**Builds on:** #24 (Workflow Engine, merged), #33 (Agent Adapter Interface, merged), #52 (Planner Agent, merged), ADR-0002 (LLM planner via AgentAdapter)
**Status:** Approved, implemented

## Summary

Add automatic issue decomposition for large incoming issues: an LLM planner (via `AgentAdapter`) produces a structured `DecompositionPlan`, persisted as a **preview file** at `<.git>/freesolo/decomposition.json`. Child GitHub issues are created **only after explicit approval** via `freesolo decomposition approve`. Humans can inspect and override the preview with `show` and `edit` before approval. Autonomous mode skips the human step by auto-approving when `FREESOLO_AUTONOMOUS=1`.

v1 ships the decomposition store, a `runIssueDecomposer` runner mirroring `runTeamPlanner`, GitHub child-issue creation on approve, CLI subcommands, and unit tests with `ScriptedAgentAdapter`. No workflow-engine policy changes — decomposition is triggered explicitly (or by autonomous callers), not by `engine tick`.

## Goals

- Decompose large issues into smaller, independently-executable child issues using `decomposeIssue()` from `src/planner/runtime.ts`.
- Persist preview plans at `<.git>/freesolo/decomposition.json` (resolved via `getFreesoloPath(worktreePath, 'decomposition.json')`).
- Validate output against the existing `decompositionPlanSchema` (`parent_issue`, `children[]` with `title`, `body`, `labels`).
- Expose `freesolo decomposition show`, `edit`, `generate`, and `approve` CLI subcommands.
- On `approve`, create GitHub child issues with `gh issue create`, ensuring each child body contains `## Parent\n\n#<parent_issue>`.
- Record applied decomposition in `<.git>/freesolo/decomposition-applied.json` (child issue numbers + titles) so re-approve is idempotent.
- Support autonomous auto-approve when `FREESOLO_AUTONOMOUS=1` is set (approve semantics without blocking on human input).

## Non-Goals

- **Heuristic "is this issue large?" gate.** v1 requires explicit `decomposition generate`; automatic triggering on token count is #45 / autonomous policy work.
- **Workflow state machine changes.** Decomposition does not add states or transitions to `state-machine.ts`. Parent issue workflow labels are unchanged by decomposition in v1.
- **Real LLM adapters.** v1 uses `ScriptedAgentAdapter` as the default injectable agent, same as team planner.
- **Event log writes in v1.** `decomposition.applied` event type exists (#23) but persisting to SQLite is optional follow-up; the applied-record file is the durable v1 artifact.
- **Parent issue closure or relabelling.** Approving decomposition creates children; it does not close or re-label the parent.
- **Nested decomposition.** Children are leaf issues; no recursive decompose-on-approve.
- **Cross-repo child issues.** All children are created in the same `owner/repo` as the parent.

## Considered Options

### A. Mirror team-plan CLI pattern with preview-first approve (recommended)

`generate` runs planner and writes preview JSON. `show`/`edit` operate on the preview. `approve` validates, creates GitHub issues, writes applied record. Matches ADR-0002 proposal semantics and issue #37 acceptance criteria.

**Pros:** Consistent with `freesolo plan *`; cheap human overrides; no garbage issues on bad planner output.
**Cons:** Two files (preview + applied) instead of one.

### B. Single file with `status: preview | applied` field

Extend schema with a status discriminator and mutate on approve.

**Rejected:** Couples preview edits to applied history; harder to re-run generate after partial failure.

### C. Create draft GitHub issues immediately

**Rejected:** Violates preview-first requirement; creates tracker noise before human review.

## Architecture

```
src/planner/
  decomposition-store.ts   # read/write/validate decomposition.json + applied record
  decomposition-runner.ts  # runIssueDecomposer — decomposeIssue + write preview
  index.ts                 # re-export new symbols

src/github/
  issues.ts                # createChildIssues(repo, parent, children) via gh

src/commands/
  decomposition.ts         # registerDecompositionCommands — generate, show, edit, approve

src/cli.ts                 # register decomposition command group
```

Why separate `decomposition-store.ts` from `store.ts`:

- Team plan and decomposition are independent artifacts with different schemas and lifecycles.
- Keeps `store.ts` unchanged; avoids a god-module.

### Data model

Uses existing types from `src/planner/schemas/decomposition-plan.ts`:

```ts
export interface DecompositionPlan {
  parent_issue: number;
  children: Array<{
    title: string;
    body: string;
    labels: string[];
  }>;
}
```

Applied record (new, not validated by planner schema):

```ts
export interface DecompositionAppliedRecord {
  parent_issue: number;
  applied_at: string; // ISO-8601
  children: Array<{
    number: number;
    title: string;
    url: string;
  }>;
}
```

Persisted at `<.git>/freesolo/decomposition-applied.json`.

### Persistence

`src/planner/decomposition-store.ts`:

- `getDecompositionPath(worktreePath)` → `decomposition.json`
- `getDecompositionAppliedPath(worktreePath)` → `decomposition-applied.json`
- `readDecomposition(worktreePath)` → `DecompositionPlan` or throws `DecompositionNotFoundError`
- `writeDecomposition(worktreePath, plan)` → path
- `validateDecompositionFile(contents)` → `DecompositionPlan` (uses `decompositionPlanSchema`)
- `readDecompositionApplied(worktreePath)` → `DecompositionAppliedRecord | null`
- `writeDecompositionApplied(worktreePath, record)` → path

Parent-issue consistency: on read/approve, `plan.parent_issue` must equal the resolved `--issue` number; mismatch is a validation error.

Child body parent link: on approve, if a child body does not contain `## Parent`, prepend `## Parent\n\n#<parent_issue>\n\n` before creating the issue. If present but references a different parent number, reject with a clear error (human edit mistake).

### Decomposition runner

`runIssueDecomposer(input)` mirrors `runTeamPlanner`:

1. Call `decomposeIssue({ adapter, issue, workingDirectory })`.
2. Assert `result.parent_issue === issue.number` (set by planner; reject mismatch).
3. `writeDecomposition(worktreePath, result)`.
4. Return `{ plan, decompositionPath }`.

Default agent (`createDefaultDecompositionAgent`) returns a deterministic two-child plan via `ScriptedAgentAdapter` for tests.

### GitHub child issue creation

`src/github/issues.ts`:

```ts
export interface CreateChildIssuesInput {
  repo: RepoRef;
  parentIssue: number;
  children: ChildIssue[];
  runGh: GhRunner; // injectable for tests
}

export interface CreatedChildIssue {
  number: number;
  title: string;
  url: string;
}

export async function createChildIssues(
  input: CreateChildIssuesInput
): Promise<CreatedChildIssue[]>
```

For each child, invoke:

```
gh issue create --repo owner/repo --title <title> --body <body> [--label L]...
```

Parse stdout for `https://github.com/owner/repo/issues/<N>` (or use `--json number,url,title` if available). Create children sequentially so failure leaves a clear partial state in stderr; applied record is written only after all succeed.

### Autonomous auto-approve

When `FREESOLO_AUTONOMOUS=1`:

- `decomposition approve` proceeds without additional confirmation (same code path as human approve).
- `decomposition generate` may be followed immediately by approve in autonomous callers (#45); v1 only documents the env var gate on approve, same engine-authority pattern as `plan approve`.

Both `generate` and `approve` require `FREESOLO_ENGINE=1` (engine-only mutations), matching `plan generate` / `plan approve`.

## CLI Surface

```
freesolo decomposition generate --issue <N>   # run planner, write decomposition.json
freesolo decomposition show     --issue <N>   # print decomposition.json to stdout
freesolo decomposition edit     --issue <N>   # open decomposition.json in $EDITOR, re-validate
freesolo decomposition approve  --issue <N>   # validate, create GitHub children, write applied record
```

`--issue` optional when session exists in worktree (`resolveIssueNumber`).

### `decomposition generate`

1. Resolve issue number, repo ref, worktree path.
2. Reject if `decomposition-applied.json` already exists (idempotent guard — use `--force` to regenerate preview only when not yet applied; if applied, must not regenerate without explicit reset ticket).
3. Fetch issue via `gh issue view` or `current-issue.md` fallback.
4. Run `runIssueDecomposer` with injected agent.
5. Print: `decomposition preview written: <path>`

Exit codes: `0` success, `1` planner/validation error, `3` engine gate (`FREESOLO_ENGINE` unset).

### `decomposition show`

Read and pretty-print `decomposition.json`. Exit `1` if missing/invalid.

### `decomposition edit`

Same temp-file + `$EDITOR` flow as `plan edit`. Does not create GitHub issues. Validates `parent_issue` matches resolved issue number on save.

### `decomposition approve`

1. Require `FREESOLO_ENGINE=1`.
2. If `decomposition-applied.json` exists, print existing children and exit `0` (idempotent).
3. Read and validate `decomposition.json`; `parent_issue` must match `--issue`.
4. `createChildIssues` via gh.
5. Write `decomposition-applied.json`.
6. Print one line per child: `#<N> <title> <url>`

Exit codes: `0` success/idempotent, `1` validation/gh error, `3` engine gate.

## Error types

- `DecompositionNotFoundError` — preview file missing
- `DecompositionValidationError` — JSON/schema/parent mismatch
- `DecompositionAlreadyAppliedError` — generate called after apply (without force)
- `ChildIssueCreationError` — gh failure with child index and stderr excerpt

## Testing

Unit tests (Vitest), following `plan-command.test.ts` patterns:

- `tests/unit/decomposition-store.test.ts` — read/write/validate, parent mismatch
- `tests/unit/decomposition-runner.test.ts` — scripted agent, parent_issue assertion
- `tests/unit/github-issues.test.ts` — mock gh runner, label flags, URL parse
- `tests/unit/decomposition-command.test.ts` — generate/show/edit/approve, engine gate, idempotent approve, autonomous env does not block

No live GitHub integration tests.

## Acceptance Criteria Mapping

| Criterion | How satisfied |
|-----------|---------------|
| Large issues broken into smaller child issues | `decomposeIssue` + schema with `children[]` min 1 |
| Generated by LLM planner via `AgentAdapter` | `runIssueDecomposer` uses `decomposeIssue` → `runPlanner` |
| Output schema structured and validated | Existing `decompositionPlanSchema` |
| Children NOT created until approval | Preview file + approve-only gh create |
| Parent/child links in tracker | Child body includes `## Parent\n\n#N` |
| Inspectable/overridable CLI | `show`, `edit`, `approve` commands |

## Open Questions (resolved for v1)

| Question | Decision |
|----------|----------|
| Change parent workflow state on generate/approve? | No — out of scope; decomposition is orthogonal |
| Regenerate after preview but before approve? | Allow `generate --force` to overwrite preview only when not applied |
| Default child labels? | Use planner output as-is; prompt already suggests `state:triaged` |
