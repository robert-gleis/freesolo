# Implementation Review — Issue #34 Team Planner — Round 1

## Status
pass

## Verification commands run
- `npm test`: PASS — 39 test files, 286 tests, all green. New work contributes 36 tests across seven new files (`team-plan-schema.test.ts` 8, `team-plan-store.test.ts` 3, `team-planner-prompt.test.ts` 1, `team-planner-extract.test.ts` 3, `team-planner-runner.test.ts` 4, `plan-command.test.ts` 16) plus one CLI registration assertion in `cli.test.ts`.
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds; `dist/src/planner/{types,schema,store,prompt,errors,extract,runner,index}.js` are emitted; `ensure-bin-executable.mjs` runs clean.

## Acceptance criteria
- **Team definition generated via AgentAdapter-conformant planner** — Met. `runTeamPlanner` in `src/planner/runner.ts:42-69` accepts an `AgentAdapter`, orchestrates `start → send → extract → validate → persist`, and maps adapter/validation failures to `TeamPlannerError`. v1 default is `createDefaultPlannerAgent` backed by `ScriptedAgentAdapter` (`runner.ts:35-39`). Runner tests cover happy path, invalid JSON, agent contract violation, and schema rejection.
- **Output conforms to JSON schema and is validated before use** — Met. Zod schema in `src/planner/schema.ts` enforces non-empty `roles`, valid `AgentHost`, positive integer `count`, and non-empty strings. Validation runs on generate (runner), edit save (`plan.ts:289-290`), approve (`readTeamPlan`), and every store read (`store.ts:38`). Eight schema tests cover all documented rejection cases plus invalid JSON in `validateTeamPlanFile`.
- **Output written to `<.git>/issueflow/team-plan.json`** — Met. `getTeamPlanPath` delegates to `getIssueflowPath(worktreePath, 'team-plan.json')` (`store.ts:15-17`), which resolves via `git rev-parse --git-path issueflow`. Store writes pretty-printed JSON with trailing newline and creates parent dirs (`store.ts:20-24`). Round-trip and path-resolution tests use real `git init` temp repos.
- **Plans inspectable/overridable via `issueflow plan` CLI** — Met. Four subcommands registered in `src/cli.ts:52` and `src/commands/plan.ts:204-351`: `generate`, `show`, `edit`, `approve`. `--issue` is optional via `resolveIssueNumber`; `show` pretty-prints JSON; `edit` opens `$EDITOR` (default `vi`), validates on save, and leaves the on-disk file untouched when validation fails.
- **Approval drives `planned → approved`** — Met. `plan approve` reads and validates the team plan, checks current state is `planned`, then calls `writeState(..., 'planned', 'approved')` behind the engine gate (`plan.ts:304-348`). Success prints `planned -> approved\n` as specified.

## Spec alignment (non-acceptance items verified)
- **Architecture** — Domain logic lives in `src/planner/` (types, schema, store, prompt, extract, errors, runner, barrel); CLI wiring in `src/commands/plan.ts`. Matches spec layout and mirrors `src/verification/` separation.
- **State transitions** — `plan generate` requires `triaged`, runs planner first, then transitions `triaged → planned` only after a successful write (`plan.ts:216-240`). Ordering prevents state advance on planner failure. `plan edit` does not touch workflow state.
- **Engine gate** — `requireEngineGate` on `generate` and `approve` only; exit `3` with message matching `state.ts` style (`plan.ts:156-165`). `show` and `edit` are ungated per spec.
- **JSON extraction** — Fenced ` ```json ` block preferred, else trimmed raw output (`extract.ts:3-14`). Three dedicated tests.
- **Non-goals respected** — No real LLM adapters, no auto-approval, no lifecycle manager, no engine policy change, no event log, team composition only (no issue decomposition).

## Error handling and exit codes

| Spec error / condition | Implementation | Tested |
|------------------------|----------------|--------|
| `TeamPlanNotFoundError` | Thrown from store; surfaced via `withCommanderErrorHandling` | show, edit |
| `TeamPlanValidationError` | Thrown from schema/store; edit catches locally; approve via handler | edit invalid save, approve |
| `TeamPlannerError` | Raised in runner/extract; generate catches via handler | runner (4 cases); generate path implicit via handler |
| Wrong state for generate/approve | Manual guard before transition; exit `1` | generate (not triaged), approve (not planned) |
| No workflow state | Null check; exit `1` | generate only |
| Malformed state labels | `MultipleStateLabelsError` / `InvalidStateLabelError` → exit `4` | generate, approve |
| Engine gate | `ISSUEFLOW_ENGINE !== '1'` → exit `3` | generate, approve |
| Issue resolution failure | `IssueIdError` → exit `2` | show |

Exit-code mapping matches the spec table for all documented paths. `plan edit` additionally handles non-zero editor exit (`plan.ts:279-283`).

## Path resolution
- `getTeamPlanPath` resolves through `git rev-parse --git-path issueflow/team-plan.json` and normalises relative git paths to absolute under the worktree (`store.ts:15-17`). This is a sensible hardening over the plan's bare `getIssueflowPath` call — `git rev-parse --git-path` can return a relative path in some worktree layouts.
- `defaultFetchIssue` tries `gh issue view --json number,title,body` first, then falls back to parsing `current-issue.md` from the issueflow dir (`plan.ts:67-96`). The extra `worktreePath` parameter (vs the plan sketch) is required for both paths and is correctly threaded from `resolveIssueContext`.

## CLI behaviour
- Injectable `PlanCommandDeps` mirrors `state.ts` / `engine.ts` patterns: all I/O, state, planner, editor, and env deps are overridable for tests.
- `withCommanderErrorHandling` rethrows `CommanderError`, maps `IssueIdError` → exit `2`, malformed labels → exit `4`, everything else → exit `1`.
- Success messages match spec: `team plan written: <path>`, pretty JSON for show, `team plan updated`, `planned -> approved`.
- `plan-command.test.ts` uses real store I/O in the harness (not mocked read/write) for show, edit, and approve happy paths — stronger integration signal than the plan's all-mocked sketch.

## Findings

None. Residual test gaps (below) are minor and do not affect spec satisfaction.

## Notes

Items verified that are worth recording so a round-2 reviewer does not relitigate them:

- **Edit "restore on validation failure".** Spec language says "restore original file," but the implementation never writes to `team-plan.json` until validation passes (`plan.ts:289-291`). On failure the original file is unchanged — strictly safer than write-then-restore. `plan-command.test.ts:226-241` asserts the on-disk content remains the pre-edit definition.
- **Minor test gaps (non-blocking).** No dedicated CLI test for: (a) `plan generate` when `runTeamPlanner` throws `TeamPlannerError`, (b) `plan edit` when the editor exits non-zero, (c) `plan approve` when the issue has no workflow state (implementation handles it at `plan.ts:317-323`, mirroring generate). Behaviour is straightforward via the shared error handler; coverage can be added opportunistically.
- **`TeamPlannerError` in `errors.ts`.** Extract and runner import from `errors.ts` rather than each other, avoiding the circular-import problem noted in the plan.
- **Runner cleanup.** `agent.stop()` runs in `finally` with swallowed errors (`runner.ts:63-68`), matching spec "best-effort."
- **Barrel completeness.** `src/planner/index.ts` re-exports the full public surface (types, schema, store, prompt, extract, errors, runner) for engine/runner reuse without pulling Commander.

## What looks good
- TDD trail is visible: types → schema → store → prompt → extract → runner → CLI → CLI registration, each with tests preceding or co-developed with implementation.
- Plan command tests use real git worktrees and real store round-trips for edit/show/approve, giving higher confidence than pure mock harnesses.
- Schema validation is enforced at every persistence boundary (write, read, edit save, approve), not only at generation time.
- Engine gate message format is consistent with `state.ts` ("engine-only… Set ISSUEFLOW_ENGINE=1… agent processes must not bypass the workflow engine").
- `createDefaultPlannerAgent` regex-matches on issue number prefix, keeping scripted responses deterministic per issue while still exercising the full adapter contract.
- Non-goals are cleanly respected — no scope creep into lifecycle management, event logging, or engine tick integration.
