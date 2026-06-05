# Plan Review — Issue #22 Factory Knowledge Base — Round 2

## Verdict
pass_with_findings

## Summary
All Round 1 blockers and major findings are resolved. Task 1 is now pure formatting helpers with a proper red/green cycle; `loadKnowledgeEntries` lives in Task 2 with filesystem tests written first. Task 3 explicitly updates `createDeps`, documents print-only placeholder behaviour, and Task 4 follows the established `buildFakeAgent()` + `buildHarness({ agent, … })` pattern with aligned `typeof defaultLoadKnowledgeEntries` typing. Blank-line formatting, empty-directory coverage, and `toHaveBeenCalledWith('/tmp/wt')` are all in place. The plan is executable on first pass. Three minor polish items remain; none block implementation.

## Findings

### Round 1 resolution

| Round 1 finding | Status |
|---|---|
| Task 4 destructures `agent` from `buildHarness` (blocker) | **Fixed** — test creates `const agent = buildFakeAgent()` separately; plan notes harness does not return `agent`. |
| Task 3 omits `createDeps` update (blocker) | **Fixed** — Step 3 item 5 adds `loadKnowledgeEntries: async () => []` default stub. |
| Task 2 TDD inversion (major) | **Fixed** — Task 1 is helpers-only; Task 2 owns `loadKnowledgeEntries` with fail-then-implement cycle. |
| `formatKnowledgeSection` blank line between entries (major) | **Fixed** — `blocks.join('\n\n')` plus explicit test asserting `\n\n###` separation. |
| `WorkflowEngineDeps` inline import typing (major) | **Fixed** — uses `loadKnowledgeEntries?: typeof defaultLoadKnowledgeEntries`. |
| Spec `start.test.ts` vs integration file (major) | **Fixed** — File Structure and Self-Review map spec wording to `tests/integration/start-command.test.ts`. |
| Empty knowledge directory test (minor) | **Fixed** — Task 2 adds explicit empty-dir case. |
| Print-only placeholder behaviour (minor) | **Fixed** — documented in Task 3 Step 3 and Self-Review. |
| `extractTitle` public export note (minor) | **Fixed** — comment marks it as test export, not spec Public API. |
| Task 2 duplicate imports (minor) | **Fixed** — consolidate-imports instruction in Task 2 Step 1. |
| `toHaveBeenCalledWith(workingDirectory)` (minor) | **Fixed** — Task 4 test asserts `'/tmp/wt'`. |
| Starter files no smoke test (minor) | **Acknowledged** — Self-Review notes optional follow-up; acceptable for v1. |
| Per-task commit steps (minor) | **Acknowledged** — Self-Review defers to implementer workflow. |

### Remaining — minor

- **Task 4 spawn test omits `readState` override; transition is invalid.** The snippet relies on `buildHarness` defaults (`readState → 'implementing'`) while setting `nextState: 'implementing'`. The state machine allows `implementing → reviewing | approved`, not `implementing → implementing`, so `writeState` will throw `InvalidTransitionError` and the tick returns `refused`. Agent `start`/`send` still run before the failed write, so the test assertions on enriched instructions will pass, but the test exercises a refused tick unlike every other spawn test (which use `readState: 'approved'`, `nextState: 'implementing'`). Align with the existing pattern to avoid misleading future readers.

- **Task 4 `buildHarness` default stub instruction is redundant.** Because `buildHarness` spreads `Partial<WorkflowEngineDeps>` and the engine defaults with `deps.loadKnowledgeEntries ?? defaultLoadKnowledgeEntries`, existing spawn tests already get `[]` from the real loader when `/tmp/wt/.issueflow/knowledge/` is absent. No harness change is required unless the implementer wants to isolate tests from filesystem I/O explicitly. The instruction is harmless but may send implementers looking for a harness edit that isn't strictly needed.

- **Task 3 test snippet shows a floating `KnowledgeEntry` import.** Step 1 displays `import type { KnowledgeEntry }` as a separate block to append. Consolidate into the file's existing import block (same pattern Task 2 already documents) to avoid lint noise.

## Notes

- Loader Public API, both spawn integration points, starter files, no-cache reads, and injectable deps match the spec. ADR-0001 already documents `.issueflow/knowledge/*.md`; no plan task needed.
- Spec §Testing Strategy optional `workflow.test.ts` kernel assertion is covered indirectly via `knowledge-loader.test.ts` and start/engine wiring tests — acceptable.
- Spec storage rule for dotfiles (`*.md` only filter loads `.hidden.md` if present) is a pre-existing spec ambiguity; out of scope for this plan unless the spec is amended.
- Task ordering and per-task commits remain sensible; Self-Review accurately reflects plan state post Round 1 fixes.
