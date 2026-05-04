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

## Worktree setup hooks

After creating or attaching a new worktree, `issueflow` runs `scripts/setup-new-worktree.sh` from that worktree when the script exists. The hook is optional; repositories that do not define it continue without setup. The hook receives `MAIN_REPO_ROOT` pointing at the source checkout so repo-specific scripts can reference files that should not be copied automatically.

Existing worktrees are reused as-is and do not run the setup hook. `--print-only` includes the conditional hook command after the `git worktree add` command.

## Reusable host assets

The reusable host assets are committed under `integrations/`:

- `integrations/codex/issueflow-workflow/SKILL.md`
- `integrations/claude/commands/issueflow.md`
- `integrations/cursor/commands/issueflow.md`

See [docs/host-integrations.md](/Users/A15AB98/.codex/worktrees/34b0/issueflow/.worktrees/issueflow-v1/docs/host-integrations.md) for manual installation instructions.
