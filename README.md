# issueflow

Issue-driven session launcher for Codex, Claude, and Cursor.

## Prerequisites

- Node.js 20+
- `gh` installed and authenticated
- Worktrunk (`wt`) installed; issueflow delegates worktree creation and placement to Worktrunk
- At least one supported host installed: Codex, Claude, or Cursor Agent (`cursor-agent`)

## Local development

```bash
npm install
npm test
npm run build
```

## Local CLI install and updates

To make the local checkout available as the `issueflow` command:

```bash
npm install
npm run build
npm link
```

After pulling or otherwise updating this checkout, rebuild the CLI:

```bash
npm install # only needed when dependencies changed
npm run build
```

You usually do not need to run `npm link` again; the global command points at this checkout. If the link points at an old clone or a moved directory, relink it from the checkout you want to use:

```bash
npm unlink -g issueflow
npm link
which issueflow
issueflow --help
```

## Usage

```bash
issueflow start --tool codex
issueflow start --tool claude --print-only
issueflow start --tool cursor
```

The `cursor` adapter uses `cursor-agent --workspace <worktree>` so the shared workflow kernel is injected at launch time instead of relying on a manual follow-up command.

## Worktree setup hooks

`issueflow start` uses Worktrunk (`wt`) to create or switch issue worktrees. Worktree paths follow your Worktrunk configuration rather than issueflow's own sibling-directory convention.

After Worktrunk creates or attaches a new worktree, `issueflow` runs `scripts/setup-new-worktree.sh` from that worktree when the script exists. The hook is optional; repositories that do not define it continue without setup. The hook receives `MAIN_REPO_ROOT` pointing at the source checkout so repo-specific scripts can reference files that should not be copied automatically.

Existing worktrees are reused as-is and do not run the setup hook. `--print-only` shows the `wt switch` command that would run and notes when Worktrunk must resolve the final checkout path at execution time.

## Reusable host assets

The reusable host assets are committed under `integrations/`:

- `integrations/codex/issueflow-workflow/SKILL.md`
- `integrations/claude/commands/issueflow.md`
- `integrations/cursor/commands/issueflow.md`

See [docs/host-integrations.md](docs/host-integrations.md) for manual installation instructions.
