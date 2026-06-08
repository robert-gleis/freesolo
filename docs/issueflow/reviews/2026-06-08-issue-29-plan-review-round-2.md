# Plan Review — Issue #29, Round 2

## Status
pass_with_findings

## Summary

All ten findings from round 1 are addressed. The four major issues (prose-only implementations, missing `resolveRepoRoot` in `GateCommandDeps`) and all six minor/nit issues are resolved with concrete, copy-runnable TypeScript. The plan is now mechanically follow-able from end to end: every task has working red tests, a full implementation, and a green-test verification step. One new important deviation from the spec was found (label colors), alongside three low-priority suggestions. The plan is ready to implement with those noted.

---

## Round 1 Findings — Resolution Verification

| Finding | Severity | Resolution |
|---------|----------|------------|
| 1 — `verdict-store.ts` implementation prose-only | major | **Resolved.** Full TS implementation block at Task 2 Step 3 (≈210 lines). |
| 2 — Tasks 3 & 4 test steps prose-only | major | **Resolved.** `gate-command.test.ts` and `pr-command.test.ts` fully written with `describe`/`it` blocks, typed factories, and exact assertions. |
| 3 — Tasks 3 & 4 implementation steps prose-only | major | **Resolved.** `src/commands/gate.ts` and `src/commands/pr.ts` fully written. |
| 4 — `GateCommandDeps` missing `resolveRepoRoot` | major | **Resolved.** `resolveRepoRoot: (cwd: string) => Promise<string>` present in `GateCommandDeps`; integration test stubs it. |
| 5 — Task 5 CLI tests prose-only | minor | **Resolved.** Two concrete `it` blocks with Commander introspection assertions. |
| 6 — Task 6 integration test prose-only | minor | **Resolved.** Three full integration scenarios with `git init` temp repo, real `loadLatestRun`/`writeRun`, stale-verdict path. |
| 7 — `--issue` mandatoriness unspecified | minor | **Resolved.** Both command headers note "`--issue` is optional, matching `verify.ts` behaviour"; CLI tests assert `issueOpt?.mandatory` is falsy. |
| 8 — `MultipleVerdictLabelsError` exit-code 4 not tested | minor | **Resolved.** Explicit test case in `pr-command.test.ts` asserts exit `4` and message matching `/multiple/i`. |
| 9 — `VerdictStatus` not imported in test snippets | nit | **Resolved.** `VerdictStatus` imported and used with explicit typed variable in `verdict-store.test.ts` and `gate-command.test.ts`. |
| 10 — Dep name ambiguity in Task 3 Step 3 | nit | **Resolved.** `GateCommandDeps` interface lists both `resolveRepoRoot` and `resolveRepoRef` by name; implementation uses both explicitly. |

---

## New Findings

### 1 — Important: Label colors in `verdict-store.ts` deviate from spec

**Location:** `src/verification/verdict-store.ts`, line `const VERDICT_LABEL_COLOR = 'BFD4F2';`

**Problem:** The spec defines two distinct colors:
- `verification:pass` → `0E8A16` (green)
- `verification:fail` → `B60205` (red)

The plan uses a single constant `BFD4F2` (a generic light blue) for both labels, passed to `gh label create --color`. This means labels will not render with the intended green/red semantics, and the plan deviates from an explicit spec requirement.

**Fix:** Replace the single constant with two per-status values and thread them through `createVerdictLabel`:

```ts
const VERDICT_LABEL_COLORS: Record<VerdictStatus, string> = {
  pass: '0E8A16',
  fail: 'B60205'
};
```

Update `createVerdictLabel` to use `VERDICT_LABEL_COLORS[status]` instead of `VERDICT_LABEL_COLOR`.

---

### 2 — Suggestion: `GateVerdictRecord.runId` typed `string` instead of `string | null`

**Location:** `src/verification/verdict-store.ts` `GateVerdictRecord` interface vs spec interface.

**Problem:** The spec defines `runId: string | null` to accommodate a potential `no-run` record. The plan narrows it to `runId: string`. In practice this is sound — the spec also says "not written on `no-run` refusal" — but it introduces a silent interface divergence from the spec that could confuse future maintainers reading both documents.

**Options:** Either update the spec to reflect the narrower type (preferred, since `no-run` records are never written), or restore `string | null` in the interface with a comment explaining the invariant. No change is required if the implementer is aware of the deviation.

---

### 3 — Suggestion: `env` field in `PrCommandDeps` is dead code

**Location:** `src/commands/pr.ts`, `PrCommandDeps.env` and `defaultDeps.env`.

**Problem:** `PrCommandDeps` declares `env: NodeJS.ProcessEnv` but `prCreateAction` never reads `deps.env`. The `pr create` command is not engine-gated (confirmed by spec), so no environment variable check is needed. The field misleads readers into thinking `pr create` has environment-gated behaviour.

**Fix:** Remove `env` from `PrCommandDeps` and `defaultDeps` in `pr.ts`. Optionally add a comment noting engine-gating is intentionally absent on this command.

---

### 4 — Suggestion: `storedRunId === null` silently bypasses stale-verdict check

**Location:** `src/commands/pr.ts`, `assertPrGate`:

```ts
if (input.storedRunId !== null && input.latestRun.runId !== input.storedRunId) {
```

**Problem:** When no local `gate-verdict.json` exists (`storedRunId === null`), the stale-verdict check is skipped entirely. The spec's check 4 states "Verdict `runId` matches latest run `runId`" without carving out a null exception. In a degraded state where the local file was deleted (but GitHub label and state are still `pass`/`pr-ready`), a PR could be created without a verified gate evaluation record. This partially undermines the "agents cannot self-certify" property.

**Options:**
- Block when `storedRunId === null` (strictest; aligns with spec intent).
- Accept the current behaviour but document it in a comment (acceptable if the maintainer treats missing local record as intentional trust of GitHub state).

No code change is required if the softer interpretation is intentional; a clarifying comment in `assertPrGate` is sufficient.

---

## What looks good

- Every round 1 major finding is resolved completely — no residual prose stubs or placeholder descriptions anywhere in the plan.
- The TDD discipline is uniform across all six tasks: red-test command, implementation block, green-test command. No task asks the agent to infer anything.
- `PrCommandDeps` injects `spawnGhPrCreate` as a separate dep rather than calling `execa` directly, making the happy-path `gh pr create` forwarding fully testable without a shell.
- The integration test correctly exercises the real `loadLatestRun` / `writeRun` / `writeGateVerdictRecord` / `readGateVerdictRecord` filesystem calls against a `git init` temp repo, fulfilling the spec's intent that cross-command state flows are tested end-to-end.
- The `assertPrGate` pure function is correctly broken out as a separately testable unit, which covers all four gate conditions (state, verdict, latest run status, runId staleness) without network calls.
- Task 7 full-suite + build verification step is present.
- The self-review table at the end of the plan is accurate and references all round 1 changes explicitly.

---

STATUS=pass_with_findings
