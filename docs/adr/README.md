# Architecture Decision Records

Human-written records of hard-to-reverse design decisions. Authoring rules: [ADR-FORMAT.md](./ADR-FORMAT.md).

Numbered files use `NNNN-slug.md` under this directory. IssueFlow scans them at agent spawn and injects the set into the issue packet; agents without IssueFlow can read these files directly.

## Not stored here

- **Review findings** — use PR comments or `docs/issueflow/reviews/` artifacts.
- **Agent audit / telemetry** — use the Event Log (see issue #23).

These are too granular or machine-scoped for ADRs.
