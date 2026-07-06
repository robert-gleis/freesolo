# Implementation Review — Issue #52, Round 1

**Status:** pass_with_findings

**Reviewer summary:** The planner module is well-structured, all four acceptance criteria are satisfied, the test suite passes cleanly (334/334), and the build is error-free. Two minor deviations from the spec were found: `buildRetryPrompt` is re-exported from the public barrel despite the spec's "nothing else is exported" clause, and the team prompt's host-enum list is a hardcoded string literal rather than being derived from `PLANNER_HOSTS`, creating a silent drift risk the spec's own risks section acknowledges but the prompt tests do not guard against at the value level.

**Test suite:** 334/334 passed
**Build:** ok

## Acceptance Criteria

| AC | Satisfied? | Evidence |
|----|------------|----------|
| Planner runs through AgentAdapter, no direct LLM SDK in engine | yes | `src/planner/runtime.ts` calls only `adapter.status()`, `adapter.start()`, `adapter.send()`, `adapter.stop()`. No LLM SDK import in any `src/planner/` file. `planner-engine-isolation.test.ts` additionally asserts `src/workflow/` contains no import of `src/planner/`. |
| Schema-validated; invalid output rejected with clear error | yes | `runPlanner` calls `schema.safeParse(parsed)` and throws `PlannerError('invalid-output', ..., { lastValidationError, attempts: maxAttempts })` after exhausting all attempts. `extract-failed` is thrown immediately on extraction failure and is not retried per spec. |
| Schemas exported and importable by #34/#37/#45 | yes | `src/planner/index.ts` exports `teamDefinitionSchema`, `teamRoleSchema`, `decompositionPlanSchema`, `childIssueSchema`, and all inferred types. `planner-index.test.ts` imports them and asserts each is defined. |
| Same runtime for both task types | yes | `runPlanner` is parameterised by `task: 'team' \| 'decomposition'`. `planTeam` and `decomposeIssue` are thin wrappers. Tests cover both paths with `ScriptedAgentAdapter`. |

## Findings

### Finding 1: `buildRetryPrompt` leaked into the public barrel

**Severity:** minor
**Location:** `src/planner/index.ts:27`, `src/planner/prompts/index.ts:3`

**Issue:** The spec's public-API block (`docs/freesolo/specs/2026-06-04-issue-52-design.md`, line 350) shows only `buildTeamPrompt` and `buildDecompositionPrompt` exported from `./prompts/index.js`. The same spec section closes with: "This is the surface #34, #37, and #45 import. Nothing else is exported." `buildRetryPrompt` is an internal function used by `runtime.ts`; it has no documented consumer. However, `src/planner/prompts/index.ts` re-exports it, and `src/planner/index.ts` picks it up in the barrel, making it part of the published surface. This is confirmed by `planner-index.test.ts` asserting `typeof buildRetryPrompt === 'function'`.

**Fix:** Remove `buildRetryPrompt` from `src/planner/prompts/index.ts` (keep it as a named export only from `src/planner/prompts/retry.ts`). Remove the corresponding re-export from `src/planner/index.ts`. Update `planner-index.test.ts` to remove the assertion that it is present. `planner-prompts.test.ts` and `planner-prompts.snapshot.test.ts` import it directly from `../../src/planner/prompts/retry.js`, so they are unaffected.

---

### Finding 2: Team prompt host-enum list is hardcoded, not derived from `PLANNER_HOSTS`

**Severity:** minor
**Location:** `src/planner/prompts/team.ts:8`

**Issue:** The `SCHEMA_DESCRIPTION` constant in `buildTeamPrompt` includes the literal string `"host": "pi" | "claude" | "codex" | "cursor"`. This value is hand-written and not derived from the `PLANNER_HOSTS` constant. If `PLANNER_HOSTS` is extended (e.g., a new host `vscode` is added to `src/planner/schemas/team-definition.ts`), the prompt will silently omit the new value and the LLM will never be told it can emit it. The `planner-prompts.test.ts` field-name assertion (`expect(prompt).toContain(field)` for each key in `teamRoleSchema.shape`) only checks that the word `"host"` appears in the prompt — it does not check that each valid enum value is present. The spec's own Risks section acknowledges this category of drift risk ("prompt drift vs. schema evolution") but the listed mitigation (field-name assertions) does not extend to enum values.

**Fix:** Derive the host list dynamically in the prompt builder:
```ts
import { PLANNER_HOSTS } from '../schemas/team-definition.js';
// in SCHEMA_DESCRIPTION or buildTeamPrompt:
const hostEnum = PLANNER_HOSTS.map(h => `"${h}"`).join(' | ');
// "host": ${hostEnum},
```
Add a companion test in `planner-prompts.test.ts` asserting that every value in `PLANNER_HOSTS` appears as a substring in the team prompt output, parallel to the existing field-name walk.

---

### Finding 3: No test for `stopped` adapter entry state

**Severity:** minor
**Location:** `tests/unit/planner-runtime.test.ts` (missing test), `src/planner/runtime.ts:44-45`

**Issue:** The adapter lifecycle table in the spec (lines 266–269) and the `shouldStart` logic in `runtime.ts` both treat `idle` and `stopped` symmetrically — both cause the planner to call `adapter.start()` and take ownership. The test suite covers the `idle` case (line 185) and the `running` case (line 208), but there is no test that constructs a `stopped` adapter (i.e., one that has been started and then stopped before `runPlanner` is called) and verifies that `runPlanner` restarts it and then stops it again on completion. The spec's required test list (lines 427–428) omits this case, so this is not a spec-required test, but the gap leaves the `stopped`-branch of `shouldStart` untested at the adapter-lifecycle level.

**Fix:** Add a test in the `runPlanner adapter lifecycle` describe block:
```ts
it('starts a stopped adapter and stops it on success', async () => {
  const adapter = new ScriptedAgentAdapter({
    steps: [{ match: /.*/, output: JSON.stringify(validTeam) }]
  });
  await adapter.start({ workingDirectory: '/tmp' });
  await adapter.stop();
  expect((await adapter.status()).state).toBe('stopped');

  await runPlanner({ adapter, task: 'team', issue });

  expect((await adapter.status()).state).toBe('stopped');
});
```

---

### Finding 4: `extractJson` has no test for empty-string input

**Severity:** minor
**Location:** `tests/unit/planner-extract.test.ts` (missing test), `src/planner/extract.ts:5-9`

**Issue:** The spec test list (line 409) specifies the case "No JSON anywhere → throws `PlannerError('extract-failed', ...)`", covered by the test at line 53. An empty string is a valid degenerate case (`output = ''`) that exercises all three extraction passes and short-circuits correctly — but it is not covered explicitly. In production, an adapter could return an empty string (e.g., a timed-out LLM call that returns `''`). The existing code handles it correctly (all three passes fail, error is thrown with `snippet: ''`), but the test suite does not verify this.

**Fix:** Add one test:
```ts
it('throws extract-failed on empty string input', () => {
  expect(() => extractJson('')).toThrow(PlannerError);
  try { extractJson(''); } catch (err) {
    expect((err as PlannerError).code).toBe('extract-failed');
    expect((err as PlannerError).details.snippet).toBe('');
  }
});
```
