# ADR Format

Mirrored from [mattpocock/skills — grill-with-docs/ADR-FORMAT.md](https://github.com/mattpocock/skills/blob/main/skills/engineering/grill-with-docs/ADR-FORMAT.md). Adopted as the FreeSolo standard.

See [README.md](./README.md) for what does **not** belong in ADRs (review findings, agent audit events).

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

## Template

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording *that* a decision was made and *why* — not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited
- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

## Numbering

Scan `docs/adr/` for the highest existing number and increment by one.

## When to write an ADR

All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "The Workflow Engine is the single source of truth; agents cannot self-certify state transitions."
- **Integration patterns between contexts.** "Adapter and Runner are orthogonal abstractions."
- **Technology choices that carry lock-in.** Persistence substrate, message bus, deployment target.
- **Boundary and scope decisions.** "Decisions live in the repo; telemetry lives in a local SQLite store."
- **Deliberate deviations from the obvious path.** Anything where a reasonable reader would assume the opposite.
- **Constraints not visible in the code.** External compliance, contract obligations, deliberate non-goals.
- **Rejected alternatives when the rejection is non-obvious.** Stops the next engineer from re-proposing the same thing.
