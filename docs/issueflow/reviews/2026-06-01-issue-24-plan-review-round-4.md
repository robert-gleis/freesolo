# Plan Review — Issue #24 Workflow Engine — Round 4

## Verdict
pass

## Summary
The plan implements every spec requirement (six refusal codes, decision/transition event semantics, pluggable policy, optional agent adapter, gated CLI subcommand with the spec's exit-code map). Imports, type names, and reference-module APIs (`RepoRef`, `InvalidTransitionError`, `MultipleStateLabelsError`, `InvalidStateLabelError`, `AgentAdapter`/`AgentResponse`/`AgentStatus`) all match what the existing modules export, and each task's "Expected: FAIL/PASS" outcomes correctly reflect what the previous task's code would do. The accepted-trade-offs section transparently documents the two coverage-locking tasks (Tasks 3 and 5) so a fresh engineer is not surprised when those tests pass against the previous task's code.

## Findings
No findings.

## Notes

Sanity checks performed against the reference modules:

- `defaultPolicy` totality test in Task 1 drives every `WORKFLOW_STATES` entry (including `closed`); the implementation returns `{ kind: 'wait', reason: 'issue is closed' }` for `closed`, satisfying `expect(action.kind).toBe('wait')`. The spec note about the engine short-circuiting before the policy is honoured by Task 2's `current === 'closed'` branch before `deps.policy(...)` is called.
- `MultipleStateLabelsError`'s real message (state-store.ts:79) is `Issue #24 has multiple workflow state labels: triaged, planned. Repair manually before retrying.` — Task 2's substring assertion `expect(result.refused?.reason).toContain('multiple workflow state labels')` matches. The malformed-state CLI test in Task 8 reuses the same wording.
- `InvalidTransitionError.message` (state-machine.ts:34) is `Invalid workflow transition: triaged → closed. Allowed from triaged: planned.` — Task 4's `expect(result.refused?.reason).toContain('Invalid workflow transition')` and Task 8's CLI fixture mirror that message exactly.
- `AgentTaskRequest` (policy.ts) declares `initialInstructions: string` (required) while `AgentStartInput` (agents/types.ts:16-19) declares `initialInstructions?: string` (optional). Passing the required field into the optional position is type-safe — no compile error.
- The CLI `REFUSAL_EXIT_CODES` map matches the spec: `2` for observational refusals (`no-state`/`terminal-state`/`policy-refused`), `1` for configuration errors (`invalid-transition`/`no-agent-adapter`), `4` for `malformed-state`.
- Decision-event ordering is preserved on every path: `emit({kind:'decision'})` fires before any `writeState` call, and the `transition` event fires only after a successful write. The `refuse()` helper synthesises an `action: { kind: 'refuse', reason }` for the state-refusal cases so the decision event is still emitted exactly once, as the spec requires.
- The CLI's spawn happy-path test (Task 8) is correctly framed as a `formatSuccess` format-string test rather than an end-to-end spawn assertion — the default CLI deps never wire an agent adapter, so the test injects a synthetic `TickResult` whose `toState` matches `action.nextState`, which is what the real engine would produce on success.
- `createWorkflowEngine` is constructed fresh inside each CLI invocation (`tick: (input) => createWorkflowEngine(defaultEngineDeps).tick(input)`), avoiding shared subscriber state across calls in the same process.
