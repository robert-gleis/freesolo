# Implementation Review — Issue #22 Factory Knowledge Base — Round 1

## Verdict
pass_with_findings

## Summary
The implementation matches the spec and plan: a pure `src/knowledge/loader.ts` module with spawn-time filesystem reads (no cache), knowledge appended outside `buildWorkflowKernel`, both spawn paths wired with injectable deps, four starter files under `.freesolo/knowledge/`, and focused unit/integration tests. `npm test` passes (34 files, 263 tests) and `npm run build` succeeds. All four acceptance criteria are met. Findings below are non-blocking coverage and spec-ambiguity notes; nothing warrants holding the merge.

## Verification commands run
- `npm test`: PASS — 34 test files, 263 tests (includes 11 new loader tests, 1 start integration test, 1 engine spawn enrichment test).
- `npm run build`: PASS — `tsc -p tsconfig.json` succeeds.

## Acceptance criteria
| Criterion | Status | Evidence |
|---|---|---|
| Knowledge automatically injected at spawn | Met | `createStartPlan` calls `appendKnowledgeToPrompt` before adapter launch (`src/commands/start.ts:354-356`, `:428`); workflow engine `spawn` branch enriches before `agent.start` and `agent.send` (`src/workflow/engine.ts:179-190`). |
| Version-controlled and reviewable | Met | Starter files at `.freesolo/knowledge/{conventions,build,test,deploy}.md`. |
| Updatable without restarting the factory | Met | `loadKnowledgeEntries` reads from disk on every call; no in-process cache. |
| Agents without FreeSolo can read files directly | Met | Plain Markdown on disk under `.freesolo/knowledge/`; no FreeSolo-specific encoding. |

## Plan task coverage
| Task | Status |
|---|---|
| Task 1 — Pure formatting helpers | Complete — `extractTitle`, `formatKnowledgeSection`, `appendKnowledgeToPrompt` with 7 unit tests. |
| Task 2 — Filesystem loader | Complete — `loadKnowledgeEntries` with ENOENT → `[]`, alphabetical `.md` filter, `isFile()` guard; 4 filesystem tests. |
| Task 3 — Wire into `freesolo start` | Complete — `loadKnowledgeEntries` on `StartPlanDeps` / `defaultDeps`; kernel then knowledge composition; integration test with stubbed loader. |
| Task 4 — Wire into workflow engine spawn | Complete — optional `loadKnowledgeEntries` on `WorkflowEngineDeps` with default fallback; spawn enrichment test asserts `start` and `send` receive the same enriched string. |
| Task 5 — Starter knowledge files | Complete — four files with accurate build/test commands and honest deploy placeholder. |

## Findings

1. **Minor — No smoke test loads the real `.freesolo/knowledge/` directory end-to-end**
   - Affected: `.freesolo/knowledge/*.md`; `tests/unit/knowledge-loader.test.ts`.
   - What's wrong: Filesystem tests use temp fixtures; start and engine tests stub `loadKnowledgeEntries`. No test asserts that the shipped starter files load, sort alphabetically (`build.md` → `conventions.md` → `deploy.md` → `test.md`), and produce a non-empty `## Factory Knowledge Base` section from the actual repo path.
   - Why it matters: A typo in a starter filename, accidental deletion, or gitignore regression would not fail CI. Low risk because Task 2 temp-dir tests cover loader mechanics and the files are present in the workspace.
   - Suggested fix: Optional follow-up — one test calling `loadKnowledgeEntries(process.cwd())` (or repo root from a known fixture) and asserting four entries with expected filenames. Plan Self-Review already defers this.

2. **Minor — Start-path knowledge test covers print-only + stub only, not launch mode**
   - Affected: `tests/integration/start-command.test.ts:611-636`; `src/commands/start.ts:339-356`.
   - What's wrong: The integration test stubs `loadKnowledgeEntries` and runs `printOnly: true`. Launch mode — where `repoRoot` is the resolved worktree path and the real loader runs — has no dedicated assertion that knowledge enrichment occurs.
   - Why it matters: A regression that skipped `loadKnowledgeEntries` in the non-print-only branch (e.g. conditional wiring) would not be caught. Engine spawn path is covered; start launch path is not.
   - Suggested fix: Add one integration test with `printOnly: false`, a stub `loadKnowledgeEntries` that records its `repoRoot` argument, and assert it equals the resolved worktree path and the launch plan prompt contains the knowledge section. Alternatively accept the gap given engine + loader coverage.

3. **Nit — Spec storage rule for dotfiles / `README.md` is ambiguous; implementation loads any `*.md`**
   - Affected: `src/knowledge/loader.ts:60`; spec §Storage Layout.
   - What's wrong: Spec says "Non-markdown files, dotfiles, and `README.md` … are ignored unless they end in `.md`." The implementation filters with `name.endsWith('.md')` only, so `.hidden.md` and `README.md` would be loaded if present. Plan review Round 3 flagged this as pre-existing spec ambiguity.
   - Why it matters: Unlikely in practice (starter layout has no README), but behaviour differs from a strict reading that excludes dotfiles and README regardless of extension.
   - Suggested fix: No code change required for v1 unless the spec is amended. If clarified, add an explicit filter (e.g. skip names starting with `.`, skip `README.md`).

4. **Nit — `extractTitle` is exported from the production module for test access**
   - Affected: `src/knowledge/loader.ts:12-20`.
   - What's wrong: Spec Public API lists three functions; `extractTitle` is exported with a "test export" comment. Matches the plan's TDD approach but widens the import surface.
   - Why it matters: External consumers could depend on a helper the spec treats as internal. No current misuse.
   - Suggested fix: Accept for v1, or move title extraction to a test-only import path in a follow-up if API surface tightening is desired.

## What looks good
- Loader is pure and isolated: formatting helpers have no I/O; filesystem reads are confined to `loadKnowledgeEntries`.
- Composition stays outside `buildWorkflowKernel` — existing `tests/unit/workflow.test.ts` unchanged; knowledge tested independently.
- Injectable deps follow established patterns: required on `StartPlanDeps`, optional with default on `WorkflowEngineDeps`; `createDeps` defaults to `async () => []` so existing start tests stay stable.
- Spawn enrichment passes the same `enrichedInstructions` to both `agent.start` and `agent.send`, matching the spec integration diagram.
- ENOENT on missing knowledge directory returns `[]` silently — spawn proceeds with kernel only, per spec.
- Alphabetical ordering, non-`.md` exclusion, and subdirectory ignoring are tested with temp fixtures.
- Starter file content matches `package.json` scripts (`npm run build`, `npm run dev`, `npm test`, `npm run test:watch`) and honestly states no deploy pipeline.
- Existing spawn test (`workflow-engine.test.ts:326-349`) implicitly verifies backward compatibility: default loader against `/tmp/wt` yields no enrichment when knowledge dir is absent.
