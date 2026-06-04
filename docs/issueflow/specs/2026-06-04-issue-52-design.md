# Issue #52 — Planner Agent (LLM-Based) Design

Spec for issue [#52](https://github.com/robert-gleis/issueflow/issues/52). Parent: epic #9 (Team Orchestration). See [ADR-0002](../../adr/0002-llm-planner-via-adapter.md).

## Summary

A reusable LLM-driven planner runtime that runs through the standard `AgentAdapter` interface (#33) and emits structured JSON for two task types: team composition (consumed by #34) and issue decomposition (consumed by #37). This ticket owns the Zod schemas for `TeamDefinition` and `DecompositionPlan`, the prompt scaffolding, the schema-validation harness, and one bounded re-prompt loop on validation failure.

This ticket does **not** wire either feature into the workflow engine or the CLI — those touch `state-machine.ts`, add CLI commands, and write `.git/issueflow/team-plan.json` / `decomposition.json`. They are #34 and #37. The scope here is the planner library that #34, #37, and #45 will import.

## Goals

- Provide canonical Zod schemas for `TeamDefinition` and `DecompositionPlan`, exported once and reused by all consumers (#34, #37, #45).
- Make the planner host-agnostic by driving it through `AgentAdapter` only — no direct LLM SDK usage.
- Make the planner task-agnostic at the call site: one entry point parametrised by task type, returning a discriminated union of validated outputs.
- Reject invalid LLM output with a clear, typed error that callers can present to a human or use as input to a retry.
- Keep the v1 surface intentionally small so #34 and #37 can land without renegotiating the contract.

## Non-Goals

- **No workflow-engine wiring.** State transitions, the `planned → approved` gate, and `<.git>/issueflow/*.json` writes are #34 / #37.
- **No CLI commands.** `issueflow plan show/edit/approve` and `issueflow decomposition show/edit/approve` are #34 / #37.
- **No GitHub child-issue creation.** That is #37 after human approval.
- **No autonomous-mode policy.** That is #45.
- **No real `AgentAdapter` implementation for an LLM.** The planner runtime is exercised in tests with `ScriptedAgentAdapter`. Real adapters for Claude / Codex / Cursor land in separate tickets under epic #8.
- **No streaming.** `AgentAdapter.send` is single-response in v1 (per #33's design).
- **No multi-turn refinement beyond schema-driven re-prompt.** The planner does not converse with the LLM about content quality; it only re-prompts on schema violation.
- **No persistence.** The planner returns a value; callers persist it.
- **No prompt-library extension surface.** Prompts are hardcoded for the two task types. Adding a third task is a code change, not config.

## Conceptual Place in the Architecture

`CONTEXT.md` distinguishes three orthogonal abstractions: `LaunchPlanBuilder` (host launchers), `AgentAdapter` (agent protocol), `Runner` (execution environment). The Planner is a *consumer* of `AgentAdapter`, not a peer of those abstractions. Its own home is a new top-level domain `src/planner/` that focuses on a single concern: turning issue text into validated structured JSON via an `AgentAdapter`.

Composition at the call site looks like this once #34 lands:

1. The Team Lifecycle Manager constructs an `AgentAdapter` (some real LLM adapter).
2. It calls `runPlanner({ adapter, task: 'team', issue })`.
3. The planner sends the rendered prompt through `adapter.send`, parses and validates the response, and returns a typed `TeamDefinition`.
4. The Team Lifecycle Manager writes the JSON to `.git/issueflow/team-plan.json` and drives the state transition.

The same call site for issue decomposition (#37) substitutes `task: 'decomposition'` and gets a typed `DecompositionPlan` back. There is no second runtime.

## Architecture

New code lives under `src/planner/`:

```
src/planner/
  schemas/
    team-definition.ts        # Zod schema + TS type for TeamDefinition
    decomposition-plan.ts     # Zod schema + TS type for DecompositionPlan
    index.ts                  # Barrel re-export of schemas + types
  prompts/
    team.ts                   # buildTeamPrompt(issue): string
    decomposition.ts          # buildDecompositionPrompt(issue): string
    index.ts                  # Barrel re-export of prompt builders
  runtime.ts                  # runPlanner — orchestrates send + extract + validate + retry
  extract.ts                  # extractJson — tolerant JSON extraction from LLM output
  errors.ts                   # PlannerError, PlannerErrorCode
  index.ts                    # Public API barrel
```

Why a new top-level directory:

- `src/agents/` is the `AgentAdapter` interface and reference adapter — the planner *uses* this directory but is not part of it.
- `src/adapters/` is for `LaunchPlanBuilder`s — unrelated.
- A planner can grow new task types, prompt variants, and (later) richer retry strategies without polluting any of the existing directories.

Public API (importable as `import { ... } from 'issueflow/planner'` once a build mapping exists; today via relative paths inside the repo) consists of:

- Types: `TeamDefinition`, `DecompositionPlan`, `PlannerIssue`, `PlannerTask`, `PlannerResult`, `PlannerOptions`
- Zod schemas: `teamDefinitionSchema`, `decompositionPlanSchema`
- Functions: `runPlanner`, `buildTeamPrompt`, `buildDecompositionPrompt`, `extractJson`
- Errors: `PlannerError`, `PlannerErrorCode`

Nothing in `src/workflow/` imports from `src/planner/` in this ticket — the engine-isolation regression test in `tests/unit/runner-engine-isolation.test.ts` is extended in spirit (see Testing) to also forbid `src/planner/` imports from the engine, so future work doesn't accidentally couple the engine to a concrete planner.

## Data Model

### `PlannerIssue`

The input shape the planner accepts. Keeps the caller's GitHub-specific representation out of the planner.

```ts
export interface PlannerIssue {
  number: number;
  title: string;
  body: string;
  labels?: string[];
}
```

The caller is responsible for fetching the issue. The planner does not call `gh`, does not read files, does not touch the network beyond what the `AgentAdapter` does internally.

### `PlannerTask`

```ts
export type PlannerTask = 'team' | 'decomposition';
```

Adding a new task is a literal addition here plus a prompt file plus a schema file. v1 has exactly two.

### `PlannerResult`

```ts
export type PlannerResult =
  | { task: 'team'; data: TeamDefinition }
  | { task: 'decomposition'; data: DecompositionPlan };
```

Discriminated by `task` so callers can `switch` on it. `runPlanner` returns the matching variant for whichever task was requested. Consumers that already know the task (#34, #37) typically narrow via a helper:

```ts
export function planTeam(opts: Omit<PlannerOptions, 'task'>): Promise<TeamDefinition>;
export function decomposeIssue(opts: Omit<PlannerOptions, 'task'>): Promise<DecompositionPlan>;
```

These are thin wrappers around `runPlanner`. They exist so #34 and #37 don't have to narrow the union manually at every call site.

### `PlannerOptions`

```ts
export interface PlannerOptions {
  adapter: AgentAdapter;        // started by the caller, or started by the planner — see "Adapter Lifecycle"
  task: PlannerTask;
  issue: PlannerIssue;
  maxAttempts?: number;         // default 2 — first attempt + 1 re-prompt on validation failure
  workingDirectory?: string;    // forwarded to adapter.start if the planner needs to start it; default '.'
}
```

`maxAttempts` is the total number of `adapter.send` calls. `2` means: first attempt + 1 re-prompt with the validation error. `1` means: no retry (give up immediately on validation failure). `0` and negative numbers are rejected by `runPlanner` with `PlannerError('invalid-options', ...)`.

## Schemas

### `TeamDefinition`

Matches the schema in issue #34 exactly:

```ts
// src/planner/schemas/team-definition.ts
import { z } from 'zod';

export const PLANNER_HOSTS = ['pi', 'claude', 'codex', 'cursor'] as const;
export type PlannerHost = (typeof PLANNER_HOSTS)[number];

export const teamRoleSchema = z.object({
  name: z.string().min(1),
  host: z.enum(PLANNER_HOSTS),
  responsibility: z.string().min(1),
  count: z.number().int().min(1)
});

export const teamDefinitionSchema = z.object({
  roles: z.array(teamRoleSchema).min(1)
});

export type TeamRole = z.infer<typeof teamRoleSchema>;
export type TeamDefinition = z.infer<typeof teamDefinitionSchema>;
```

Constraints chosen on top of what #34 explicitly states:
- `roles` must be non-empty — a plan with zero roles is malformed by definition.
- `count` is a positive integer — fractional or zero counts are nonsense.
- `host` is enumerated to the four hosts `CONTEXT.md` and the existing `HostTool` type recognise. New hosts must be added in both places (`src/adapters/index.ts` and here) consciously.

The `host` enum is the canonical source for *what an LLM is allowed to emit* in a `TeamDefinition`. The existing `HostTool` literal in `src/core/types.ts` is the canonical source for *what the CLI can launch today*. The two are not identical: `HostTool` is currently `'codex' | 'claude' | 'cursor'`, while the planner enum includes `'pi'` (per issue #34's schema, anticipating a future Pi adapter).

The relationship is a one-way containment: every launchable host must be a valid planner-emitted host, but the planner may also emit hosts that the CLI cannot launch yet (those will be caught by the consumer, e.g. #34 when it tries to start an agent). A regression test (see Testing) asserts that containment: `HostTool ⊆ PlannerHost`. The test exists so a new launchable host can never be added to `src/core/types.ts` without also being added to the planner schema.

### `DecompositionPlan`

Matches the schema in issue #37 exactly:

```ts
// src/planner/schemas/decomposition-plan.ts
import { z } from 'zod';

export const childIssueSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  labels: z.array(z.string().min(1))
});

export const decompositionPlanSchema = z.object({
  parent_issue: z.number().int().positive(),
  children: z.array(childIssueSchema).min(1)
});

export type ChildIssue = z.infer<typeof childIssueSchema>;
export type DecompositionPlan = z.infer<typeof decompositionPlanSchema>;
```

Constraints chosen on top of #37:
- `parent_issue` is a positive integer — GitHub issue numbers start at 1.
- `children` is non-empty — a decomposition without children is a useless decomposition.
- `labels` is required but may be `[]`. The schema-level requirement guards against the LLM omitting the field entirely.

## Prompts

Prompts are TypeScript template functions, not external files. They live as code so they can reference the schemas at build time and so a schema change forces a corresponding prompt review.

```ts
// src/planner/prompts/team.ts
import type { PlannerIssue } from '../types.js';

export function buildTeamPrompt(issue: PlannerIssue): string {
  // Header + role / schema description + JSON example + the issue body.
  // Returns a single string for adapter.send.
}
```

Required content of each prompt (enforced by snapshot tests):

1. **Role framing.** "You are a planner agent. Your job is to ..."
2. **Output contract.** "Respond with a single JSON object matching this schema:" followed by a JSON-shaped example. The example is constructed from the schema's TS type, hand-written, and kept in sync via test.
3. **Output discipline.** "Do not include explanations, prose, or markdown — JSON only." (The runtime is tolerant of fences anyway; this line is for prompt clarity, not correctness.)
4. **Issue payload.** The issue number, title, body, and labels (if any), each clearly delimited.

The prompts are hand-tuned and committed. They are not configurable at runtime in v1. If a consumer needs a different prompt style, they can build their own `AgentAdapter` wrapper around the planner — that is the extension point.

### Re-prompt prompt

When the first attempt's output fails schema validation, the planner sends a follow-up message via `adapter.send`. The follow-up is:

```
The previous response did not match the required schema.

Validation error:
<the formatted zod error>

Respond again with a single JSON object that matches the schema exactly. No explanations, no markdown.
```

This is constructed by `buildRetryPrompt(error: z.ZodError): string` in `src/planner/prompts/retry.ts`. Snapshot-tested for stability.

## Runtime

```ts
// src/planner/runtime.ts

export async function runPlanner(opts: PlannerOptions): Promise<PlannerResult>;
```

Behaviour, in order:

1. **Validate options.** Reject `maxAttempts < 1` with `PlannerError('invalid-options', ...)`.
2. **Ensure adapter is running.** If `adapter.status()` reports `idle` or `stopped`, the planner calls `adapter.start({ workingDirectory: opts.workingDirectory ?? '.' })`. If the adapter is already `running`, the planner uses it as-is. If it is in any other state (`starting`, `stopping`, `error`), the planner throws `PlannerError('adapter-not-ready', ...)` without sending anything.
   - **The planner does not stop adapters it did not start.** It only stops adapters it started, and only on its way out (success or failure). This mirrors typical resource-ownership patterns: who acquires, releases.
3. **Build the initial prompt** from `buildTeamPrompt` or `buildDecompositionPrompt` (selected via `opts.task`).
4. **Loop up to `maxAttempts` times:**
   1. `const { output } = await adapter.send(promptForThisAttempt)`.
   2. `const parsed = extractJson(output)` — throws `PlannerError('extract-failed', ...)` if no JSON-shaped substring can be found. Extraction failure is NOT retried in v1 — it is surfaced. (Rationale: if the LLM didn't return JSON at all, schema feedback won't help.)
   3. `const validated = schemaForTask.safeParse(parsed)`.
   4. On success: stop the adapter (only if the planner started it), return `{ task, data: validated.data }`.
   5. On failure: if this is not the last attempt, set the next prompt to `buildRetryPrompt(validated.error)` and continue. If this is the last attempt, stop the adapter (if owned) and throw `PlannerError('invalid-output', message, { lastValidationError: validated.error, attempts })`.
5. **On any thrown error from `adapter.send`:** the planner catches it, stops the adapter (if owned), and re-throws wrapped in `PlannerError('adapter-failed', message, { cause })`. The original error is preserved on `cause`.

The runtime is deliberately small and synchronous-feeling. It owns one async loop and one schema lookup. It does not log, does not measure timing, does not write files.

### Adapter Lifecycle Summary

| Adapter state on entry | Planner action |
|---|---|
| `idle` | Calls `start`, then runs. Calls `stop` on exit (success or failure). |
| `stopped` | Calls `start`, then runs. Calls `stop` on exit. |
| `running` | Uses as-is. Does NOT call `stop` on exit. |
| `starting` / `stopping` / `error` | Throws `PlannerError('adapter-not-ready', ...)`. |

This contract is documented in JSDoc on `runPlanner` and exercised by tests.

## JSON Extraction

LLMs frequently wrap JSON in markdown fences or precede it with prose ("Here is the team plan:"). The extractor tolerates this.

```ts
// src/planner/extract.ts

export function extractJson(output: string): unknown;
```

Algorithm:

1. **Try direct parse.** `JSON.parse(output.trim())`. If it succeeds, return it.
2. **Strip a fenced block.** Match `/```(?:json)?\s*([\s\S]*?)\s*```/` (first capture group is the fenced content). Try `JSON.parse` on the first match. If it succeeds, return it.
3. **Find the outermost `{...}`.** Use a brace-matching scan from the first `{` to its matching `}` to find the largest balanced JSON object substring. Try `JSON.parse`. If it succeeds, return it.
4. **Give up.** Throw `PlannerError('extract-failed', 'no JSON found in output', { snippet: output.slice(0, 500) })`.

Notes:
- The brace-matching pass is intentionally simple: it tracks `{` / `}` depth and ignores braces inside string literals (a one-line state machine with an "inside string" flag). It does not attempt to parse JSON-with-comments, trailing-commas, or other malformed JSON variants — the schema layer below is strict, and tolerating those variants makes the spec quietly accept malformed inputs.
- Extraction never inspects content semantically — it only finds and parses a JSON-shaped substring. The schema layer decides whether the *content* is valid.

## Errors

A single error class with a discriminant `code`:

```ts
// src/planner/errors.ts

export type PlannerErrorCode =
  | 'invalid-options'      // bad maxAttempts, missing fields
  | 'adapter-not-ready'    // adapter is in starting/stopping/error
  | 'adapter-failed'       // adapter.send rejected; original on .cause
  | 'extract-failed'       // no JSON-shaped substring in output
  | 'invalid-output';      // JSON parsed but schema rejected after all attempts

export interface PlannerErrorDetails {
  cause?: unknown;
  lastValidationError?: import('zod').ZodError;
  attempts?: number;
  snippet?: string;
}

export class PlannerError extends Error {
  readonly code: PlannerErrorCode;
  readonly details: PlannerErrorDetails;
  constructor(code: PlannerErrorCode, message: string, details?: PlannerErrorDetails);
}
```

This mirrors the shape of `AgentAdapterError` and `RunnerError` in the existing codebase. Consumers do `if (err instanceof PlannerError && err.code === 'invalid-output') ...` to decide whether to surface to a human (#34's edit/approve loop) or fail hard.

## Public API

```ts
// src/planner/index.ts

export type {
  PlannerIssue,
  PlannerTask,
  PlannerResult,
  PlannerOptions,
  TeamDefinition,
  TeamRole,
  DecompositionPlan,
  ChildIssue,
  PlannerErrorCode,
  PlannerErrorDetails
} from './...';

export {
  teamDefinitionSchema,
  teamRoleSchema,
  decompositionPlanSchema,
  childIssueSchema
} from './schemas/index.js';

export { runPlanner, planTeam, decomposeIssue } from './runtime.js';
export { buildTeamPrompt, buildDecompositionPrompt } from './prompts/index.js';
export { extractJson } from './extract.js';
export { PlannerError } from './errors.js';
```

This is the surface #34, #37, and #45 import. Nothing else is exported.

## Acceptance Criteria Mapping

| Issue criterion | Where it is satisfied |
|---|---|
| Planner runs through `AgentAdapter`, no direct LLM SDK usage in the workflow engine | `runPlanner` accepts an `AgentAdapter` and calls only `status / start / send / stop`. No direct LLM SDK is imported anywhere in `src/planner/`. The workflow engine doesn't import `src/planner/` at all in this ticket. |
| Output JSON is schema-validated; invalid output is rejected with a clear error | `runPlanner` validates with zod and throws `PlannerError('invalid-output', ...)` with the full `ZodError` in `details.lastValidationError` after `maxAttempts` failures. |
| Schemas are exported and importable by #34, #37, and #45 | `teamDefinitionSchema` and `decompositionPlanSchema` (plus their inferred types) are re-exported from `src/planner/index.ts`. |
| The same planner runtime serves both team planning and decomposition (parametrized by task type) | `runPlanner(opts)` takes `task: 'team' \| 'decomposition'`. Convenience wrappers `planTeam` and `decomposeIssue` exist for narrowed call sites. |

## Testing

All tests live under `tests/unit/` (flat, matching repo convention). Fixtures live under `tests/fixtures/planner/`.

### `tests/fixtures/planner/`

Golden inputs for snapshot tests:

```
tests/fixtures/planner/
  issues/
    small-bugfix.json           # PlannerIssue
    medium-feature.json
    large-epic-needs-decomposition.json
  outputs/
    small-bugfix.team.json      # valid TeamDefinition for small-bugfix
    medium-feature.team.json
    large-epic.decomposition.json
```

Each `outputs/*.json` is a hand-authored, known-valid example used as a return-from-LLM in the `ScriptedAgentAdapter` script. The fixtures live in the repo and are version-controlled — there is no recorded LLM traffic to replay.

### `tests/unit/planner-schemas.test.ts`

- `teamDefinitionSchema` accepts every fixture in `tests/fixtures/planner/outputs/*.team.json`.
- `teamDefinitionSchema` rejects: missing `roles`, empty `roles`, `count: 0`, `count: 1.5`, `host: 'unknown'`, missing `responsibility`, role with empty `name`.
- `decompositionPlanSchema` accepts every fixture in `tests/fixtures/planner/outputs/*.decomposition.json`.
- `decompositionPlanSchema` rejects: missing `parent_issue`, `parent_issue: 0`, `parent_issue: -1`, empty `children`, child missing `body`, child with non-string label.

### `tests/unit/planner-prompts.test.ts`

For each prompt builder (`buildTeamPrompt`, `buildDecompositionPrompt`, `buildRetryPrompt`):

- The output contains the issue number, title, body, and labels (positive assertions, not snapshots — snapshots over the whole string churn too much when the prompt is tuned).
- The output contains the literal token `JSON` and the words "schema" (case-insensitive) — the prompt promises a JSON response against a schema.
- `buildRetryPrompt(zodError)` includes the formatted error.

A separate snapshot test in `planner-prompts.snapshot.test.ts` captures the full text for each builder with a fixed input. Snapshots churn when prompts are tuned; the snapshot test is the human-review signal that a prompt change is intentional.

### `tests/unit/planner-extract.test.ts`

Cases:

- Plain JSON object → returned as-is.
- JSON wrapped in `\`\`\`json ... \`\`\`` → returned.
- JSON wrapped in `\`\`\` ... \`\`\`` (no language tag) → returned.
- JSON preceded by prose ("Here is the plan: { ... }") → returned via brace-match path.
- Nested objects with strings containing `{` and `}` → balance respects string literals, returns full outer object.
- No JSON anywhere → throws `PlannerError('extract-failed', ...)` with `details.snippet` populated.
- Malformed JSON inside a fence → throws `PlannerError('extract-failed', ...)`.

### `tests/unit/planner-runtime.test.ts`

Uses `ScriptedAgentAdapter` as the `AgentAdapter`. Each test sets up a script that returns a chosen output for the first matching prompt.

- **Happy path, team:** Script returns a valid `TeamDefinition` JSON. `runPlanner({ task: 'team', ... })` returns `{ task: 'team', data: <validated> }`.
- **Happy path, decomposition:** Script returns a valid `DecompositionPlan` JSON. `runPlanner` returns the narrowed variant.
- **Convenience wrappers:** `planTeam(opts)` and `decomposeIssue(opts)` return the unwrapped `.data`.
- **Re-prompt success:** Script returns invalid JSON on first send (missing required field), valid JSON on second send. `runPlanner` succeeds with `maxAttempts: 2`. Asserts the second script step matched a retry-prompt input via a substring match on the validation error.
- **Re-prompt exhausted:** Script returns invalid JSON on every send. `runPlanner` rejects with `PlannerError('invalid-output', ...)`, `details.attempts === maxAttempts`, `details.lastValidationError` is a `ZodError`.
- **Extraction failure is not retried:** Script returns plain prose with no JSON. `runPlanner` rejects with `PlannerError('extract-failed', ...)` after exactly one `send` (no retry, by spec).
- **Adapter ownership — idle on entry:** Constructs an idle adapter, runs, asserts the adapter was started and stopped by the planner.
- **Adapter ownership — running on entry:** Caller starts the adapter, runs, asserts the planner did NOT stop it.
- **Adapter ownership — error path on idle entry:** Adapter is idle, script makes `send` throw. Planner stops the adapter before re-throwing as `PlannerError('adapter-failed', ...)`.
- **Adapter wrong state on entry:** Adapter is in `starting` (mocked) → `PlannerError('adapter-not-ready', ...)`, no `send` ever called.
- **Invalid options:** `maxAttempts: 0` rejects synchronously with `PlannerError('invalid-options', ...)`, adapter is never touched.

### `tests/unit/planner-host-enum-consistency.test.ts`

Asserts a one-way containment: every value in `HostTool` (from `src/core/types.ts`) appears in `teamRoleSchema`'s `host` enum. This is structural — the test reads the schema enum's runtime values and asserts each `HostTool` literal is present.

To make this test possible without changing existing source-of-truth semantics, the test introduces (as a small in-scope refactor) `export const HOST_TOOLS = ['codex', 'claude', 'cursor'] as const;` in `src/core/types.ts`, then redefines `export type HostTool = (typeof HOST_TOOLS)[number];`. The literal-union semantics are unchanged — `HostTool` still equals `'codex' | 'claude' | 'cursor'` — but now the test can iterate `HOST_TOOLS` and check membership in the schema enum.

Parallel to that, the planner schema module defines its own `export const PLANNER_HOSTS = ['pi', 'claude', 'codex', 'cursor'] as const;` and uses it in `teamRoleSchema`. The test then asserts `HOST_TOOLS.every(h => (PLANNER_HOSTS as readonly string[]).includes(h))`.

This catches the failure mode where someone adds a new launchable host to `HostTool` (e.g., `'pi'` gets a real launcher) but forgets to update the planner schema. It does NOT prevent the planner from being a superset — that is by design (see Schemas section).

### `tests/unit/planner-engine-isolation.test.ts`

Mirror of `runner-engine-isolation.test.ts`:

- Reads every `.ts` file under `src/workflow/`.
- Asserts no file contains an import string targeting `src/planner/` (regex on `from '../planner'`, `from '../../planner'`, etc.).
- This guards the engine-isolation property going forward, even though the engine doesn't yet import the planner today.

### No Integration Tests

There are no subprocess invocations, no network I/O, no filesystem writes in this ticket — the planner is a pure function over an `AgentAdapter`. `ScriptedAgentAdapter` exists to make that adapter deterministic in tests. Real-adapter integration is the concern of future host-adapter tickets, not this one.

## Backwards Compatibility

Purely additive:

- New directory `src/planner/`. No existing module imports from it.
- New test files under `tests/unit/` and fixtures under `tests/fixtures/planner/`.
- Small refactor in `src/core/types.ts`: extract `HostTool` as `typeof HOST_TOOLS[number]` with `HOST_TOOLS = ['codex', 'claude', 'cursor'] as const`. Type-equivalent — `HostTool` still resolves to `'codex' | 'claude' | 'cursor'`. Required for the host-enum-consistency test to iterate the runtime values.
- `package.json` dependencies do not change. `zod` is already present at `^4.1.5`.

## Open Decisions

None for v1.

- **Whether to support multi-turn conversation beyond schema-driven retry.** Deferred — the planner's job is schema-driven JSON, not exploration. If a future ticket needs the LLM to ask clarifying questions, that is a different agent.
- **Where to put real-LLM adapter tests.** Out of scope — they belong to the ticket that lands a real adapter (epic #8 follow-ups).
- **Whether to record planner traffic for offline replay.** Out of scope — `ScriptedAgentAdapter` covers determinism today; record-replay can be added later under epic #8 if a real adapter wants it.

## Risks

- **Prompt drift vs. schema evolution.** If a schema changes (e.g., add a field) and the prompt isn't updated, the LLM will keep emitting the old shape and validation will fail every time. Mitigation: the prompt tests assert that the prompt mentions every field name in the schema (via a `Object.keys(schema.shape)` walk). This catches the "added a field, forgot to mention it in the prompt" failure mode at test time.
- **Real LLMs may need different prompts per host.** Possible — a Claude prompt and a Codex prompt may need different framing. v1 ships one prompt per task and assumes the host doesn't matter. If this turns out wrong, the planner gains a `promptVariant: 'claude' | 'codex' | 'default'` option and the test surface grows by one axis. The v1 contract does not commit to "one prompt per task forever".
- **`extractJson` brace-matching is simple by design.** It will not handle JSON-with-comments or multi-object outputs. If a future host emits such things, the extractor grows a new pass rather than the existing passes being made more lenient.
- **Host enum stays in sync by convention plus one test.** Real risk is a new host being added in adapters/ without anyone running this test. Mitigation: the test runs in the default `vitest` suite, so it fails as soon as someone adds a host without updating the schema.

## Recommendation

Ship the `src/planner/` module exactly as described: two Zod schemas, one runtime function with two convenience wrappers, a tolerant JSON extractor, and one typed error class. Drive everything through `AgentAdapter`. Validate with `ScriptedAgentAdapter` in unit tests against golden-input fixtures. Keep the surface minimal so #34, #37, and #45 can land without renegotiating the contract.
