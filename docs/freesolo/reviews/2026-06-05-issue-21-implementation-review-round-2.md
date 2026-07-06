# Implementation Review — Issue #21 — Round 2

**Verdict:** pass

## Summary

Round 1 actionable findings are addressed. The integration suite now asserts the ADR section and empty-list message in the written issue packet, and a repo-layout smoke test confirms `listAdrs` discovers real numbered ADRs under `docs/adr/`. Core implementation is unchanged from round 1 and remains aligned with the spec: isolated `src/memory/` module, spawn-time ADR injection into the issue packet after `## Body`, and non-goal documentation in place. **264 tests pass** and **`npm run build`** succeeds. No new defects.

## Round 1 Follow-up

| Finding | Round 1 severity | Status | Evidence |
|---|---|---|---|
| Integration suite does not assert ADR section in written packet | minor | **Fixed** | `tests/integration/start-command.test.ts:194-195` — `expect(packets[0]).toContain('## Architecture Decision Records')` and `expect(packets[0]).toContain('No numbered ADRs found under docs/adr/.')` in the full stage-1 packet test |
| No test for non-`ENOENT` filesystem errors | minor (optional v1) | Deferred | Still no `EACCES` mock test; round 1 marked low priority; implementation rethrows correctly |
| `printOnly` mode calls `listAdrs` on placeholder worktree path | minor (optional v1) | Deferred | `start.ts:338` unchanged; harmless, results unused in print-only mode |
| No smoke test against repo ADRs | suggestion | **Fixed** | `tests/unit/adrs.test.ts:105-114` — `listAdrs against repo layout` resolves repo root from test file, asserts ≥2 ADRs, ascending order, and slug `state-persistence-split` |

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| ADRs under `docs/adr/` with sequential numbering | Met | `isNumberedAdrFilename` / `parseAdrFilename`; `nextAdrNumber` returns `max + 1` or `1` |
| Format follows `ADR-FORMAT.md` | Met | Human review only (v1 non-goal); format docs excluded from scan |
| Spawn context loads ADR set (file scan) | Met | `listAdrs` in `start.ts` → `workflowInput.adrs` → `buildIssuePacket` |
| Readable without FreeSolo | Met | `docs/adr/README.md` states plain-file readability |
| Review findings not stored here | Met | `docs/adr/README.md` + cross-link in `ADR-FORMAT.md` |

## Findings

No findings.

## What Was Verified

- **Round 1 regression guard:** Integration test with `listAdrs: async () => []` stub now catches dropped ADR injection from `createStartPlan` / `buildIssuePacket`.
- **Repo smoke test:** `listAdrs(repoRoot)` against this checkout finds at least two numbered ADRs including `0001-state-persistence-split.md`; sort order assertion guards ordering regressions.
- **Unit coverage retained:** `start-adrs.test.ts` still verifies `listAdrs` called with resolved worktree path and non-empty ADR content in packet; `workflow.test.ts` covers `formatAdrSection` empty and populated cases.
- **Module boundary:** `adrs.ts` imports only `node:fs/promises` and `node:path`; dependency direction unchanged.
- **Build & tests:** 264/264 tests pass across 36 files; `tsc -p tsconfig.json` clean.

## Not in Scope (Confirmed Non-Goals)

ADR authoring CLI, format validation/linting, Knowledge Base injection (#22), Event Log (#23), workflow-kernel prompt changes — correctly omitted.
