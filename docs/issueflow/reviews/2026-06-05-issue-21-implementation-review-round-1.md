# Implementation Review — Issue #21 — Round 1

**Verdict:** pass_with_findings

## Summary

Implementation matches the spec and plan. The `src/memory/` module is isolated (filesystem-only, no workflow/CLI imports), the public API matches the design doc, spawn-time injection lands in the issue packet after `## Body`, and non-goal documentation is in place. All 263 tests pass and `npm run build` succeeds. No blocking bugs or missing acceptance criteria were found.

## Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| ADRs under `docs/adr/` with sequential numbering | Met | `isNumberedAdrFilename` / `parseAdrFilename`; `nextAdrNumber` returns `max + 1` or `1` |
| Format follows `ADR-FORMAT.md` | Met | Human review only (v1 non-goal); format docs excluded from scan |
| Spawn context loads ADR set (file scan) | Met | `listAdrs` in `start.ts` → `workflowInput.adrs` → `buildIssuePacket` |
| Readable without IssueFlow | Met | `docs/adr/README.md` states plain-file readability |
| Review findings not stored here | Met | `docs/adr/README.md` + cross-link in `ADR-FORMAT.md` |

## Plan Task Coverage

| Task | Status |
|---|---|
| 1 — Filename helpers | Complete |
| 2 — `listAdrs` / `nextAdrNumber` | Complete (includes plan-review edge cases) |
| 3 — Memory barrel export | Complete |
| 4 — Issue packet ADR section | Complete (`adrs?: AdrRecord[]` with `?? []`) |
| 5 — Wire `listAdrs` into `issueflow start` | Complete (deps injection, integration `createDeps` updated) |
| 6 — Non-goal documentation | Complete |
| 7 — Full verification | Complete (263 tests, build green) |

## Findings

### minor — Integration suite does not assert ADR section in written packet

- **Location:** `tests/integration/start-command.test.ts` (`writes the full stage-1 packet…`, ~line 160)
- **What's wrong:** `createDeps` stubs `listAdrs: async () => []`, and the test asserts labels, repo root, and artifacts in the packet, but never checks for `## Architecture Decision Records` or the empty-list message. A regression that dropped ADR injection from `createStartPlan` would not be caught by integration tests.
- **What to change:** Add `expect(packets[0]).toContain('## Architecture Decision Records')` (and optionally the empty message) to the existing packet assertion, or add a dedicated integration case with a non-empty `listAdrs` stub.

### minor — No test for non-`ENOENT` filesystem errors

- **Location:** `src/memory/adrs.ts` (`readAdrDirectory`); `tests/unit/adrs.test.ts`
- **What's wrong:** Spec states unreadable directories (permissions, etc.) should propagate `NodeJS.ErrnoException`. Implementation rethrows correctly, but no test exercises `EACCES` or similar. Plan marked this optional for v1.
- **What to change:** Optional follow-up — mock `fs.readdir` to reject with `{ code: 'EACCES' }` and assert rejection. Low priority unless the project routinely tests permission errors.

### minor — `printOnly` mode calls `listAdrs` on placeholder worktree path

- **Location:** `src/commands/start.ts` (~lines 336–338)
- **What's wrong:** When `printOnly` is true, `worktreePath` is `<worktrunk-checkout>`. `listAdrs` still runs against that non-existent path (returns `[]` via `ENOENT` with default deps). Results are unused because `writeIssuePacket` is skipped. Harmless but wasteful.
- **What to change:** Optional — guard `listAdrs` behind `!input.printOnly`, or defer until a real path is known. Not required for v1 correctness.

### suggestion — No smoke test against repo ADRs

- **Location:** `tests/unit/adrs.test.ts`
- **What's wrong:** Tests use `mkdtemp` fixtures only. The repo already has `docs/adr/0001-state-persistence-split.md` and `0002-llm-planner-via-adapter.md`; a single test calling `listAdrs(process.cwd())` (or repo root fixture) would catch path/join regressions against real layout.
- **What to change:** Optional — one test asserting `listAdrs` finds at least the known numbered files when run from repo root. Keep isolated fixtures as primary coverage.

## What Was Verified

- **Module boundary:** `adrs.ts` imports only `node:fs/promises` and `node:path`. `kernel.ts` imports the type; dependency direction is correct.
- **Scan rules:** `ADR-FORMAT.md`, `CONTEXT-FORMAT.md`, `README.md` excluded; `foo.md` ignored; duplicate numbers sorted stably by filename.
- **Packet format:** Matches spec — `### ADR-{NNNN}: {slug}`, `Path: {relativePath}`, full body; empty list message exact.
- **Worktree scoping:** `start-adrs.test.ts` confirms `listAdrs` called with resolved worktree path (`/tmp/issue-21`), not source checkout.
- **Kernel unchanged:** `buildWorkflowKernel` does not embed ADRs; stage order and review-loop instructions untouched.
- **Documentation:** `docs/adr/README.md` content matches plan; `ADR-FORMAT.md` cross-link present after opening paragraph.

## Not in Scope (Confirmed Non-Goals)

- ADR authoring CLI, format validation/linting, Knowledge Base injection (#22), Event Log (#23), workflow-kernel prompt changes — correctly omitted.
