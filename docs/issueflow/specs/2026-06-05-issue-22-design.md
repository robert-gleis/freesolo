# Factory Knowledge Base Design

**Issue:** [#22 — Factory Knowledge Base](https://github.com/robert-gleis/issueflow/issues/22)
**Parent:** #14 — Epic: Operational Memory
**Related:** [ADR-0001](../../adr/0001-state-persistence-split.md) (persistence split rationale)
**Status:** Draft, awaiting user review

## Summary

Add a version-controlled Knowledge Base of repo-specific operational facts under `.issueflow/knowledge/*.md` and inject those entries into every agent's startup instructions at spawn time. Agents pick up edits on the next spawn with no factory restart. Agents running without IssueFlow can read the same files directly.

## Goals

- Store operational knowledge as free-form Markdown, one topic per file, under `.issueflow/knowledge/*.md`.
- Load knowledge from disk at spawn time (no caching) and prepend a structured section to the agent startup prompt.
- Wire injection into both spawn paths today: `issueflow start` (adapter launch) and the workflow engine's `spawn` action (`AgentAdapter.start` / `send`).
- Ship starter knowledge files for this repository (conventions, build, test, deploy).
- Keep the loader pure and testable — filesystem I/O isolated behind small functions.

## Non-Goals

- A CLI subcommand for listing or editing knowledge (`issueflow knowledge …`). Files are edited directly; a CLI can land in a follow-up.
- Schema validation or front-matter parsing for knowledge files. v1 treats each file as opaque Markdown.
- Size limits, truncation, or summarisation of oversized knowledge. v1 injects the full text; a future ticket can add budgets if prompts hit host limits.
- Host-specific injection mechanisms (Cursor rules, Codex skills, etc.). Prompt append is host-agnostic and works through existing adapters.
- Event-log persistence of knowledge reads. Telemetry for knowledge injection belongs in the Event Log epic, not here.

## Storage Layout

```
.issueflow/
  knowledge/
    conventions.md   # coding style, commit conventions, project language
    build.md         # how to build
    test.md          # how to test
    deploy.md        # how to deploy (or explicit "not applicable" note)
```

Rules:

- Only `*.md` files directly under `.issueflow/knowledge/` are loaded. Subdirectories are ignored in v1.
- Files are sorted alphabetically by filename before concatenation so injection order is deterministic.
- A missing directory or empty directory yields zero entries — spawn proceeds with the workflow kernel only (no error).
- Non-markdown files, dotfiles, and `README.md` in the knowledge directory are ignored unless they end in `.md`.

## Public API

New module `src/knowledge/loader.ts`:

```ts
export interface KnowledgeEntry {
  /** Filename relative to the knowledge directory, e.g. "build.md". */
  filename: string;
  /** First `#` heading in the file, or the filename stem when no heading exists. */
  title: string;
  /** Raw file contents (UTF-8). */
  content: string;
}

/** Read all knowledge markdown files. Returns [] when the directory is missing or empty. */
export async function loadKnowledgeEntries(repoRoot: string): Promise<KnowledgeEntry[]>;

/** Format entries as a Markdown section. Returns '' when entries is empty. */
export function formatKnowledgeSection(entries: KnowledgeEntry[]): string;

/** Append the knowledge section after basePrompt, separated by a blank line. No-op when entries is empty. */
export function appendKnowledgeToPrompt(basePrompt: string, entries: KnowledgeEntry[]): string;
```

`formatKnowledgeSection` shape (when entries are non-empty):

```markdown
## Factory Knowledge Base

The following operational knowledge applies to this repository. It is loaded from `.issueflow/knowledge/*.md` at agent spawn time.

### <title from conventions.md>

<file content>

### <title from build.md>

<file content>
```

Title extraction: scan the file for the first line matching `^#\s+(.+)$`. If none, use the filename without extension (`build.md` → `build`).

## Integration Points

### `issueflow start`

In `createStartPlan` (`src/commands/start.ts`), after `buildWorkflowKernel(workflowInput)`:

1. `const entries = await loadKnowledgeEntries(repoRoot)`
2. `const startupPrompt = appendKnowledgeToPrompt(kernel, entries)`
3. Pass `startupPrompt` to the adapter as today.

`loadKnowledgeEntries` is injected through `StartPlanDeps` for testability (defaulting to the real implementation).

### Workflow engine spawn

In `createWorkflowEngine` (`src/workflow/engine.ts`), on the `spawn` branch, before `agent.start`:

1. `const entries = await loadKnowledgeEntries(action.agent.workingDirectory)`
2. `const enriched = appendKnowledgeToPrompt(action.agent.initialInstructions, entries)`
3. Pass `enriched` to both `agent.start({ …, initialInstructions: enriched })` and `agent.send(enriched)`

`loadKnowledgeEntries` is injected through `WorkflowEngineDeps` (optional, defaulting to the real implementation) so engine tests can stub an empty knowledge base without touching the filesystem.

### What is not changed

- `buildWorkflowKernel` and `buildIssuePacket` stay issue-focused. Knowledge is appended outside the kernel builder so the kernel tests remain stable and knowledge can be tested independently.
- `session.json#currentStage` is untouched.
- GitHub workflow state labels are untouched.

## Acceptance Criteria Mapping

| Criterion | How it is met |
|---|---|
| Knowledge automatically injected at spawn | `start.ts` and `engine.ts` call `appendKnowledgeToPrompt` before adapter/engine spawn |
| Version-controlled and reviewable | Files live under `.issueflow/knowledge/` in the repo |
| Updatable without restarting the factory | Loader reads from disk on every spawn; no in-process cache |
| Agents without IssueFlow can read files directly | Plain Markdown on disk; ADR-0001 documents the layout |

## Testing Strategy

- **Unit tests** (`tests/unit/knowledge-loader.test.ts`): title extraction, section formatting, append behaviour, alphabetical ordering, empty/missing directory handling. Use a temp directory fixture.
- **Unit tests** (`tests/unit/workflow.test.ts` or new file): `appendKnowledgeToPrompt` integration with a sample kernel string.
- **Unit tests** (`tests/unit/start.test.ts` or extend existing): assert `createStartPlan` passes knowledge-enriched prompt to the adapter when knowledge files exist (inject fake loader).
- **Unit tests** (`tests/unit/workflow-engine.test.ts`): assert spawn path enriches `initialInstructions` when knowledge entries are returned by the injected loader.

## Starter Knowledge Files

Ship four starter files with accurate content for this repository:

- `conventions.md` — TypeScript ESM, TDD with Vitest, commit style, `CONTEXT.md` language
- `build.md` — `npm run build`, `npm run dev`
- `test.md` — `npm test`, `npm run test:watch`
- `deploy.md` — note that deployment is not configured in v1 (honest placeholder)

## Open Questions (resolved for v1)

| Question | Decision |
|---|---|
| Inject into issue packet too? | No — issue packet is for issue context; knowledge is operational and belongs in the startup prompt only |
| Cache loaded entries? | No — hot-update requirement forbids caching |
| Subdirectories? | Ignored in v1 to keep glob simple |
