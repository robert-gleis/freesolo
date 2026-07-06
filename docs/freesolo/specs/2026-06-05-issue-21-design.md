# Issue #21 — Architecture Decision Records (ADRs)

**Issue:** [#21 — Architecture Decision Records (ADRs)](https://github.com/robert-gleis/freesolo/issues/21)
**Parent:** #14 — Epic: Operational Memory
**Status:** Draft, awaiting user review

## Summary

Wire up ADRs as first-class operational memory: a small `src/memory/` module scans `docs/adr/` for numbered decision files, and `freesolo start` injects the loaded set into the issue packet at spawn time. Conventions (`docs/adr/`, `ADR-FORMAT.md`, ADR-0001/0002) already exist from commit `55f014f`; this ticket delivers the loader, spawn-time injection, a `nextAdrNumber` helper, and explicit non-goal documentation for review findings.

## Goals

- ADRs live under `docs/adr/` with sequential `NNNN-slug.md` numbering (already true; loader must recognise the pattern).
- Format follows `docs/adr/ADR-FORMAT.md` (already documented; no validator in v1 — human review in PRs is the enforcement).
- Agent spawn context loads the ADR set via filesystem scan — no index file, no SQLite, no GitHub API.
- Agents running without FreeSolo can still read ADRs as plain Markdown files in the repo (unchanged; injection is additive).
- Review findings and agent audit events are explicitly documented as **non-goals** for ADRs.

## Non-Goals

- **Review findings store.** PR comments and `docs/freesolo/reviews/*` artifacts stay where they are. ADRs are not a home for ephemeral review output.
- **Agent audit / telemetry.** Planner choices, spawn events, and lifecycle telemetry belong in the Event Log (#23), not ADRs.
- **ADR authoring CLI.** No `freesolo adr new` command in v1. Authors create files manually following `ADR-FORMAT.md` and use `nextAdrNumber()` (exported for tests and future CLI) to pick the next id.
- **ADR format validation / linting.** No schema enforcement beyond filename pattern matching. Optional frontmatter (`Status`, etc.) is allowed by `ADR-FORMAT.md` but not parsed in v1.
- **Knowledge Base injection (#22).** Sibling ticket; `src/memory/` is structured so `.freesolo/knowledge/` can land beside ADRs later without reshaping this module.
- **Workflow-kernel changes beyond issue-packet content.** Stage order and review-loop instructions stay as-is.

## Design Decisions

### Approach considered

| Approach | Pros | Cons |
|---|---|---|
| **A. Inline full ADR bodies in issue packet** (chosen) | Agents get decisions immediately; no extra reads; matches "injected at spawn" intent from epic #14 | Larger packet; re-spawn picks up edits automatically anyway |
| B. Paths only in packet | Small packet | Agents may skip reads; fails "load the ADR set" spirit |
| C. Separate `.git/freesolo/adr-snapshot.md` | Keeps `current-issue.md` smaller | Extra file to discover; duplicates packet pattern |

**Recommendation:** Approach A. ADRs are intentionally short; the issue packet already carries the full issue body. A dedicated `## Architecture Decision Records` section with each ADR's relative path and full body is the simplest injection point and reuses existing `writeIssuePacket` plumbing.

### Filename rules

Numbered ADR files match `^(\d{4})-(.+)\.md$` (four-digit prefix, kebab slug).

**Excluded** from scan results (convention/format docs, not decisions):

- `ADR-FORMAT.md`
- `CONTEXT-FORMAT.md`
- `README.md` (created by this ticket for non-goals)

Sorting: ascending by numeric prefix. Duplicate numbers: sort is stable by filename; `nextAdrNumber` uses `max(number) + 1`.

### Module layout

```
src/memory/
  adrs.ts      # scan, load, nextAdrNumber, filename helpers
  index.ts     # barrel re-export
```

`src/memory/adrs.ts` is pure filesystem I/O over `docs/adr/` relative to `repoRoot`. No imports from `workflow/`, `commands/`, or adapters.

### Public API

```ts
export interface AdrRecord {
  number: number;
  slug: string;
  filename: string;
  relativePath: string;   // e.g. docs/adr/0001-state-persistence-split.md
  content: string;        // raw file body
}

export function isNumberedAdrFilename(filename: string): boolean;
export function parseAdrFilename(filename: string): { number: number; slug: string } | null;

export async function listAdrs(repoRoot: string): Promise<AdrRecord[]>;
export async function nextAdrNumber(repoRoot: string): Promise<number>;
```

- `listAdrs`: reads `docs/adr/`; returns `[]` if directory missing (`ENOENT`); rethrows other FS errors.
- `nextAdrNumber`: `max(numbers) + 1`, or `1` when no numbered ADRs exist.

### Spawn-time injection

**`src/workflow/kernel.ts`**

- Extend `WorkflowKernelInput` with `adrs: AdrRecord[]` (default `[]` at call sites that omit it).
- `buildIssuePacket` appends a section after `## Body`:

```markdown
## Architecture Decision Records

{If empty: "No numbered ADRs found under docs/adr/."}

{For each ADR:}
### ADR-{NNNN}: {slug}
Path: {relativePath}

{content}
```

**`src/commands/start.ts`**

- Before `buildIssuePacket` / `buildWorkflowKernel`, call `listAdrs(repoRoot)`.
- Pass result into `workflowInput`.

Injection is written to `.git/freesolo/current-issue.md` via existing `writeIssuePacket`. Hot-update: editing an ADR and re-running `freesolo start` (or manually rewriting the packet) picks up changes — no daemon restart.

### Non-goal documentation

Add `docs/adr/README.md` with:

- Pointer to `ADR-FORMAT.md` for authoring rules.
- Explicit **not stored here** list: review findings (`docs/freesolo/reviews/`, PR threads), agent audit events (Event Log / #23).
- Note that plain-file readability works with or without FreeSolo.

Add one sentence to `ADR-FORMAT.md` under **When to write an ADR** cross-linking the README non-goals (avoid duplicating the full list).

## Errors

- Missing `docs/adr/` → empty ADR list, not an error.
- Unreadable directory (permissions, etc.) → propagate `NodeJS.ErrnoException`.
- Malformed filenames in directory (e.g. `foo.md`) → ignored silently (not numbered ADRs).

## Testing

| File | Coverage |
|---|---|
| `tests/unit/adrs.test.ts` | `isNumberedAdrFilename`, `parseAdrFilename`, `listAdrs` ordering/exclusion/ENOENT, `nextAdrNumber` edge cases |
| `tests/unit/workflow.test.ts` | `buildIssuePacket` renders ADR section with path + body; empty list message |

Use fixture directories under `tests/fixtures/adrs/` with temporary dirs via `fs.mkdtemp` where isolation is needed.

## Acceptance Criteria Mapping

| Criterion | How |
|---|---|
| ADRs under `docs/adr/` with sequential numbering | Existing layout + `nextAdrNumber` helper |
| Format follows `ADR-FORMAT.md` | Documented; human PR review |
| Spawn context loads ADR set (file scan) | `listAdrs` + `start.ts` injection |
| Readable without FreeSolo | Unchanged; README states this |
| Review findings not stored here | `docs/adr/README.md` + `ADR-FORMAT.md` cross-link |

## Related

- ADR-0001 — persistence split rationale.
- #22 — Factory Knowledge Base (future `src/memory/knowledge.ts`).
- #23 — Event Log (agent audit telemetry).
