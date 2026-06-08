# Implementation Review — Issue #22 Factory Knowledge Base — Round 2

## Verdict
pass

## Summary
Round 1's two actionable coverage gaps are resolved. The new smoke test loads the real `.issueflow/knowledge/` directory and the new launch-mode integration test asserts `loadKnowledgeEntries` receives the resolved worktree path and enriches the startup prompt. Round 1 nits (spec dotfile/README ambiguity, `extractTitle` export surface) remain accepted for v1 with no code change. `npm test` passes (34 files, 265 tests) and `npm run build` succeeds. All four acceptance criteria remain met. No new findings.

## Verification commands run
- `npm test`: PASS — 34 test files, 265 tests (+2 since Round 1: starter smoke test, launch-mode start test).
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds.

## Round 1 resolution

| Round 1 finding | Status | Evidence |
|---|---|---|
| Minor — No smoke test loads real `.issueflow/knowledge/` | **Fixed** | `tests/unit/knowledge-loader.test.ts:124-136` calls `loadKnowledgeEntries` against `path.resolve(import.meta.dirname, '../..')`, asserts four starter filenames in alphabetical order (`build.md`, `conventions.md`, `deploy.md`, `test.md`), and checks `formatKnowledgeSection` output contains `## Factory Knowledge Base` and `npm run build`. |
| Minor — Start-path test covers print-only + stub only | **Fixed** | `tests/integration/start-command.test.ts:638-663` runs `createStartPlan` with `printOnly: false`, stubs `loadKnowledgeEntries` to record `repoRoot`, asserts `loadCalls` equals `['/wt/issue-12-ship-issueflow-start']`, and verifies launch prompt contains `## Factory Knowledge Base` and `npm test`. |
| Nit — Spec storage rule for dotfiles / `README.md` ambiguous | **Accepted for v1** | `src/knowledge/loader.ts:60` still filters `name.endsWith('.md')` only. Pre-existing spec ambiguity documented in plan review Round 3; no regression from Round 1. |
| Nit — `extractTitle` exported for test access | **Accepted for v1** | `src/knowledge/loader.ts:12-20` unchanged; comment documents test-only intent. No external misuse. |

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Knowledge automatically injected at spawn | Met | `createStartPlan` enriches before adapter launch (`src/commands/start.ts:354-356`, `:426-428`); workflow engine `spawn` branch enriches before `agent.start` and `agent.send` (`src/workflow/engine.ts:179-190`). |
| Version-controlled and reviewable | Met | Starter files at `.issueflow/knowledge/{conventions,build,test,deploy}.md`; smoke test guards against deletion or gitignore regression. |
| Updatable without restarting the factory | Met | `loadKnowledgeEntries` reads from disk on every call; no in-process cache. |
| Agents without IssueFlow can read files directly | Met | Plain Markdown on disk under `.issueflow/knowledge/`; no IssueFlow-specific encoding. |

## Findings

None.

## What looks good
- Round 1 coverage gaps closed without over-testing: one repo-root smoke test and one launch-mode assertion complement existing temp-fixture and stub-based tests.
- Loader, start wiring, engine wiring, and starter file content unchanged and still aligned with spec and plan.
- Launch test correctly targets the resolved worktree path (`resolveBranchWorktreePath` → `/wt/issue-12-ship-issueflow-start`), matching production `repoRoot = worktreePath` semantics.
- Starter knowledge content matches `package.json` scripts; deploy placeholder is honest.
- Print-only placeholder behaviour (`WORKTRUNK_CHECKOUT_PLACEHOLDER` → empty real loader) remains documented known v1 behaviour; actual spawn paths are covered.
