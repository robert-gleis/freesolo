# issueflow

Issue-driven session launcher for Codex, Claude, and Cursor.

## Prerequisites

- Node.js 20+
- `gh` installed and authenticated
- At least one supported host installed: Codex, Claude, or Cursor Agent (`cursor-agent`)

## Local development

```bash
npm install
npm test
npm run build
```

## Usage

```bash
issueflow start --tool codex
issueflow start --tool claude --print-only
issueflow start --tool cursor
```

The `cursor` adapter uses `cursor-agent --workspace <worktree>` so the shared workflow kernel is injected at launch time instead of relying on a manual follow-up command.

## Reusable host assets

The reusable host assets are committed under `integrations/`:

- `integrations/codex/issueflow-workflow/SKILL.md`
- `integrations/claude/commands/issueflow.md`
- `integrations/cursor/commands/issueflow.md`

See [docs/host-integrations.md](/Users/A15AB98/.codex/worktrees/34b0/issueflow/.worktrees/issueflow-v1/docs/host-integrations.md) for manual installation instructions.
