# Issue #29 — Verification Gate Design

**Issue:** [#29 — Verification Gate](https://github.com/robert-gleis/issueflow/issues/29)
**Parent:** #12 — Epic: Verification System
**Builds on:** #20 (Verification Pipeline, merged) and #24 (Workflow Engine, merged)
**Status:** Draft, awaiting user review

## Summary

Add a hard, workflow-engine-enforced gate between the `verifying` and `pr-ready` workflow states. The gate reads the latest verification pipeline run (#20), records an authoritative pass/fail verdict against the issue, transitions workflow state accordingly, and blocks `issueflow pr create` when verification has not passed. Agents cannot self-certify past this gate — PR creation consults persisted verification results, not agent claims.

## Goals

- Block PR creation when the latest verification run for the issue did not pass.
- Record each gate evaluation as a durable verdict on the issue (GitHub label + local structured record).
- On gate failure, move the issue back to `implementing` with an explicit next-action message operators and agents can follow.
- On gate pass, advance the issue to `pr-ready` so PR creation is permitted.
- Keep gate evaluation engine-gated (`ISSUEFLOW_ENGINE=1`) so only the workflow engine (or an authorised runner invoking engine commands) can advance past verification.
- Keep PR-creation checks independent of agent self-reporting — `issueflow pr create` re-validates state and verdict before calling `gh pr create`.

## Non-Goals

- Running the verification pipeline itself (that is `issueflow verify` from #20).
- Generating reviewer artifacts from verification output (separate ticket under #12).
- Auto-running verification on every engine tick (the agent or runner still invokes `issueflow verify` explicitly).
- Hooking or patching the bare `gh pr create` binary — enforcement is through `issueflow pr create`.
- Retention, rotation, or remote sync of verification logs.
- Changing the nine-state workflow table from #17 beyond using existing `verifying → pr-ready` and `verifying → implementing` transitions.

## Acceptance Criteria Mapping

| Criterion | How this design satisfies it |
|-----------|------------------------------|
| PR cannot be created if verification fails | `issueflow pr create` refuses when workflow state is not `pr-ready`, when no passing verdict exists, or when the latest run status is not `pass`. Exit code `1` with a message naming the blocking reason. |
| Gate verdict is recorded against the issue | Each evaluation writes `verification:pass` or `verification:fail` on the GitHub issue (mutually exclusive labels, swapped atomically) and persists `gate-verdict.json` under `.git/issueflow/verifications/issue-<N>/`. |
| Gate failures put the issue into a state with a clear next action | Failed evaluations transition `verifying → implementing` and the verdict record includes a `nextAction` string (e.g. "Fix failing checks, run `issueflow verify`, then re-run `issueflow gate evaluate`."). CLI prints the same string on stderr. |

## Architecture

New code under `src/verification/` and `src/commands/`:

```
src/verification/
  gate.ts              # pure evaluateGate(latestRun | null) → GateEvaluation
  verdict-store.ts     # readVerdict / writeVerdict (GitHub labels + local JSON)
src/commands/
  gate.ts              # issueflow gate evaluate (engine-gated)
  pr.ts                # issueflow pr create (gate-enforced wrapper around gh)
```

The workflow engine itself does not grow new action kinds. Gate evaluation is a dedicated CLI command the engine (or runner) calls while the issue is in `verifying`. State transitions use the existing `writeState` path from #17, invoked only when `ISSUEFLOW_ENGINE=1`.

### Data flow

1. Agent finishes implementation review and moves the GitHub issue to `state:verifying` (via engine).
2. Agent runs `issueflow verify` — pipeline writes a run under `.git/issueflow/verifications/issue-<N>/<runId>/`.
3. Engine (or authorised operator) runs `issueflow gate evaluate --issue <N>`:
   - Reads current workflow state; refuses unless state is `verifying`.
   - Loads `loadLatestRun(repoRoot, issueNumber)` from #20 store.
   - Calls `evaluateGate(latestRun)` (pure).
   - Writes verdict (label swap + `gate-verdict.json`).
   - On pass: `writeState(..., 'verifying', 'pr-ready')`.
   - On fail: `writeState(..., 'verifying', 'implementing')`.
   - On no run / blocked: no state change, exit `2` with next action.
4. Agent runs `issueflow pr create --title ... --body ...`:
   - Confirms state is `pr-ready`.
   - Confirms latest verdict is `pass` and matches the latest run id.
   - Delegates to `gh pr create` with forwarded args.
   - On any check failure: exit `1`, print next action, do not create PR.

## Gate Evaluation (pure)

```ts
// src/verification/gate.ts

export type GateOutcome = 'pass' | 'fail' | 'no-run';

export interface GateEvaluation {
  outcome: GateOutcome;
  runId: string | null;
  reason: string;
  nextAction: string;
}

export function evaluateGate(latestRun: VerificationRun | null): GateEvaluation;
```

Rules:

| Condition | `outcome` | `nextAction` |
|-----------|-----------|--------------|
| `latestRun === null` | `no-run` | `Run issueflow verify for this issue, then issueflow gate evaluate.` |
| `latestRun.status === 'pass'` | `pass` | `Create a pull request with issueflow pr create.` |
| `latestRun.status === 'fail'` | `fail` | `Fix failing checks, run issueflow verify, then issueflow gate evaluate.` |

`reason` is a one-line human summary suitable for logs (includes run id when a run exists).

## Verdict Persistence

### GitHub labels

Prefix: `verification:`. Exactly one verdict label per issue at any time.

- `verification:pass` — colour `0E8A16` (green)
- `verification:fail` — colour `B60205` (red)

`writeVerdict` swaps labels in one `gh issue edit --remove-label ... --add-label ...` call (same atomicity pattern as `writeState`). Missing labels are created on demand via `gh label create --force`.

`readVerdict(repo, issueNumber)` returns `'pass' | 'fail' | null`. Multiple `verification:*` labels throws `MultipleVerdictLabelsError` (mirrors `MultipleStateLabelsError`).

### Local record

Path: `.git/issueflow/verifications/issue-<N>/gate-verdict.json`

```ts
interface GateVerdictRecord {
  schemaVersion: 1;
  issueNumber: number;
  runId: string | null;
  outcome: GateOutcome;
  reason: string;
  nextAction: string;
  evaluatedAt: string; // ISO 8601
}
```

Written on every successful `gate evaluate` invocation (pass or fail). Not written on `no-run` refusal (nothing authoritative to record yet).

## CLI Surface

### `issueflow gate evaluate --issue <number>`

Engine-gated (`ISSUEFLOW_ENGINE=1` required; exit `3` without it — same pattern as `issueflow state transition` and `issueflow engine tick`).

Behaviour:

1. Resolve repo root and issue number (override → session → branch, reusing `resolveIssueNumber`).
2. Read workflow state; if not `verifying`, print refusal and exit `2`.
3. Load latest verification run.
4. Evaluate gate.
5. If `outcome === 'no-run'`: print `nextAction` to stderr, exit `2`, no label or state change.
6. Otherwise: write verdict, transition state (`pr-ready` or `implementing`), print one-line summary to stdout, exit `0` on pass / `1` on fail.

Stdout examples:

```
gate pass (run 2026-06-01T08-00-00-000Z) -> pr-ready
gate fail (run 2026-06-01T08-00-00-000Z) -> implementing
```

### `issueflow pr create [gh pr create options...]`

Not engine-gated (agents invoke it), but gate-enforced.

Pre-checks (all must pass before `gh pr create`):

1. Workflow state is `pr-ready`.
2. `readVerdict` returns `pass`.
3. `loadLatestRun` exists and `status === 'pass'`.
4. Verdict `runId` matches latest run `runId` (prevents stale pass label after a newer failing run).

On failure: stderr explains which check failed and prints `nextAction` from `gate-verdict.json` if present, else a sensible default. Exit `1`. No PR created.

On success: forwards remaining argv to `gh pr create` (execa, inherit stdio). Exit code matches `gh`.

`--print-only` (optional): print the checks that would run and whether they would pass, without creating a PR. Exit `0` if all checks would pass, `1` otherwise.

## Error Handling

| Situation | Exit code | State / verdict change |
|-----------|-----------|------------------------|
| Not `ISSUEFLOW_ENGINE=1` on `gate evaluate` | `3` | none |
| Issue not in `verifying` during `gate evaluate` | `2` | none |
| No verification run during `gate evaluate` | `2` | none |
| Gate pass | `0` | verdict `pass`, state → `pr-ready` |
| Gate fail | `1` | verdict `fail`, state → `implementing` |
| PR pre-check fails | `1` | none |
| `gh pr create` fails after checks pass | `gh` code | none |
| `MultipleVerdictLabelsError` | `4` | none (operator must repair) |
| `readState` / `writeState` errors | propagate | depends |

## Testing Strategy

Unit tests (injected deps, no network):

- **`tests/unit/verification-gate.test.ts`** — `evaluateGate` for null run, pass run, fail run; `nextAction` strings.
- **`tests/unit/verdict-store.test.ts`** — label read/write with fake `gh`, local JSON roundtrip, `MultipleVerdictLabelsError`.
- **`tests/unit/gate-command.test.ts`** — engine gate, wrong state, no-run, pass/fail paths with stub deps.
- **`tests/unit/pr-command.test.ts`** — blocked when state wrong, verdict fail, stale verdict, happy path forwards to stub `gh`.
- **`tests/unit/cli.test.ts`** (modify) — `gate` and `pr` subcommands registered.

Integration test:

- **`tests/integration/gate-pr-command.test.ts`** — temp repo with fake `gh` script on PATH: verify → gate evaluate pass → pr create allowed; failing run blocks pr create.

## Backwards Compatibility

Additive only:

- New CLI subcommands; existing `verify`, `engine`, `state`, `start` unchanged.
- New optional GitHub labels; repos without them are unaffected until gate runs.
- No changes to `session.json` schema or workflow kernel stage list.

## Design Alternatives Considered

1. **Policy-driven gate inside `engine.tick`** — rejected for v1 because running verification and evaluating results inside every tick couples I/O-heavy subprocess work to a lightweight orchestrator. A dedicated `gate evaluate` command keeps ticks fast and matches how agents already invoke `verify` explicitly.
2. **Verdict stored only in local JSON** — rejected because acceptance requires the verdict "against the issue"; GitHub labels give operators a visible dashboard without parsing local files.
3. **Block bare `gh pr create` via git hooks** — rejected as fragile and out of scope; IssueFlow enforces through its own PR command and `pr-ready` state.

## Open Decisions

None for v1.
