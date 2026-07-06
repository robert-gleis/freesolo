# State persistence: repo files for knowledge, SQLite for telemetry

Four persistence concerns (ADRs, Knowledge Base, Event Log, Worktree Metadata) need a substrate. We split by **who owns the data and who needs to read it**: repository-scoped knowledge that should follow the code and be readable by any agent (with or without FreeSolo) lives as Markdown in the repo; high-frequency, machine-scoped telemetry lives in a local SQLite store at `~/.freesolo/state.db`.

## Considered Options

- **All in SQLite** — rejected: ADRs and Knowledge Base lose PR-reviewability and become invisible to agents running outside FreeSolo.
- **All as files in the repo (JSONL for events)** — rejected: append-only logs with concurrent writers create git contention and bloat history.
- **GitHub as the database** (issue comments, labels) — rejected for queryable stores: rate-limited and not indexable.

## Concrete layout

| Concern | Location | Format |
|---|---|---|
| ADRs (architecture decisions) | `docs/adr/NNNN-slug.md` | Markdown (see `ADR-FORMAT.md`) |
| Knowledge Base | `.freesolo/knowledge/*.md` | Free-form Markdown |
| Event Log | `~/.freesolo/state.db`, table `events` | SQLite (WAL mode) |
| Worktree Metadata | `~/.freesolo/state.db`, table `worktrees` | SQLite (WAL mode) |

## Consequences

- Agents running without FreeSolo can still read and contribute to ADRs and Knowledge Base via normal file operations.
- The local SQLite file is host-bound; multiple machines running FreeSolo against the same repo do not share telemetry. That is intentional — telemetry is operational, not architectural.
