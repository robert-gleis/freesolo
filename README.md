# issueflow

**IssueFlow** is the control plane that turns GitHub issues into shipped pull requests by orchestrating teams of agents through an explicit, persisted workflow — the autonomous software factory.

## How it works

IssueFlow drives every issue through a fixed state machine:

```
triaged → planned → approved → implementing → reviewing → verifying → pr-ready → merged → closed
```

State is stored as a single `state:*` label on the GitHub issue — no external database needed for the workflow itself. From triage to merge, every step is enforced by the Workflow Engine; agents cannot skip or self-certify past gates.

## Prerequisites

- **Node.js 20+**
- **`gh`** — GitHub CLI, installed and authenticated
- **Worktrunk (`wt`)** — IssueFlow delegates worktree creation and placement to Worktrunk
- **At least one supported host** — Codex, Claude Code, or Cursor Agent (`cursor-agent`)
- **`better-sqlite3`** — installed automatically via `npm install`

## Installation

```bash
git clone <repo>
cd issueflow
npm install
npm run build
npm link          # makes `issueflow` available globally
```

After pulling updates:

```bash
npm install       # only when dependencies changed
npm run build
```

If the global link ever points at an old clone:

```bash
npm unlink -g issueflow
npm link
which issueflow
issueflow --help
```

## Quick start

Pick up the next assigned issue and launch your preferred host in a dedicated worktree:

```bash
issueflow start --tool claude
issueflow start --tool codex
issueflow start --tool cursor
issueflow start --tool claude --print-only   # preview without launching
```

`issueflow start` reads the current issue from the worktree's `issueflow/current-issue.md` (written by Worktrunk). It creates or reattaches the worktree, then runs `scripts/setup-new-worktree.sh` when that script exists in the repo.

---

## Full command reference

### `state` — inspect and advance workflow state

```bash
issueflow state get --issue 17
# prints current state, or "null" with exit code 2 when no state:* label

ISSUEFLOW_ENGINE=1 issueflow state transition --issue 17 --to planned
```

The `ISSUEFLOW_ENGINE=1` environment variable is required for all state-mutating commands so that agent processes cannot bypass the engine.

---

### `plan` — team planning

Generates a `team-plan.json` in the worktree that describes which agent roles should work on the issue. Transitions the issue `triaged → planned → approved`.

```bash
# 1. Generate a team plan via the LLM planner
ISSUEFLOW_ENGINE=1 issueflow plan generate --issue 17

# 2. Inspect the generated plan
issueflow plan show --issue 17

# 3. Edit the plan manually before approval
issueflow plan edit --issue 17

# 4. Validate and approve — transitions planned → approved
ISSUEFLOW_ENGINE=1 issueflow plan approve --issue 17
```

ADRs from `docs/adr/` and Knowledge Base files from `.issueflow/knowledge/` are injected automatically into the planner's context.

---

### `decomposition` — issue decomposition

For large issues, IssueFlow can decompose an issue into smaller child issues on GitHub.

```bash
# Generate a decomposition preview (does not create issues yet)
issueflow decomposition generate --issue 17

# Inspect the preview
issueflow decomposition show --issue 17

# Edit the preview in $EDITOR
issueflow decomposition edit --issue 17

# Approve: validates the preview and creates child issues on GitHub
ISSUEFLOW_ENGINE=1 issueflow decomposition approve --issue 17
```

---

### `team` — agent team lifecycle

Creates and manages a team of agents derived from `team-plan.json`. Transitions the issue `approved → implementing`.

```bash
# Start the team — requires ISSUEFLOW_ENGINE=1
ISSUEFLOW_ENGINE=1 issueflow team start --issue 17

# Inspect the running team snapshot
issueflow team status --issue 17

# Cancel a running team
issueflow team stop --issue 17
```

---

### `verify` — verification pipeline

Runs a configurable pipeline of checks against the current repo state. Checks are defined in `issueflow.config.json` at the repo root.

```bash
issueflow verify --issue 17
issueflow verify --issue 17 --bail            # stop after first failure
issueflow verify --issue 17 --print-only      # show the plan without running
issueflow verify --issue 17 --config ./path/to/config.json
```

**`issueflow.config.json` example:**

```json
{
  "verification": {
    "checks": [
      { "name": "build", "command": "npm", "args": ["run", "build"] },
      { "name": "test",  "command": "npm", "args": ["test"] }
    ]
  }
}
```

Each check has a `name`, `command`, optional `args`, `cwd`, and `env` overrides.

---

### `gate` — verification gate

Evaluates the recorded verification run and writes a pass/fail verdict that the engine checks before allowing PR creation.

```bash
ISSUEFLOW_ENGINE=1 issueflow gate evaluate --issue 17
```

---

### `candidate` — integration branch

When a team works in multiple worktrees, IssueFlow merges the individual branches into a single candidate branch for review.

```bash
ISSUEFLOW_ENGINE=1 issueflow candidate create --issue 17
issueflow candidate show --issue 17
```

---

### `pr` — pull request management

Creates a pull request from the verified candidate branch. Requires the verification gate to have passed.

```bash
ISSUEFLOW_ENGINE=1 issueflow pr create --issue 17
issueflow pr show --issue 17
```

---

### `merge` — merge readiness check

Evaluates whether a pull request is ready to merge (CI status, review approvals, labels) and writes a structured verdict. Optionally syncs a comment to the PR summarising the result.

```bash
ISSUEFLOW_ENGINE=1 issueflow merge evaluate --issue 17
ISSUEFLOW_ENGINE=1 issueflow merge evaluate --issue 17 --merge-method squash
issueflow merge show --issue 17
```

---

### `watch` — autonomous issue watcher

Polls GitHub for issues labelled `state:triaged` and drains them through the Workflow Engine automatically.

```bash
# Single poll + drain cycle (good for CI/cron)
issueflow watch once

# Continuous loop — graceful shutdown on SIGINT/SIGTERM
ISSUEFLOW_ENGINE=1 issueflow watch run
ISSUEFLOW_ENGINE=1 issueflow watch run --interval 30 --trigger-label state:triaged
```

Configure defaults in `.issueflow/config.json`:

```json
{
  "watcher": {
    "interval_seconds": 60,
    "trigger_label": "state:triaged"
  }
}
```

---

### `engine` — workflow engine tick

Advance a single issue one step through the workflow engine. Used internally by `watch` and available for scripted orchestration.

```bash
ISSUEFLOW_ENGINE=1 issueflow engine tick --issue 17
```

---

### `reports` — review and test report artifacts

Agents write `TEST_REPORT.md` and `REVIEW_REPORT.md` into the worktree during the reviewing phase. Use this command to inspect them.

```bash
issueflow reports show --issue 17
```

---

### `timeline` — workflow timeline

Renders a human-readable timeline for an issue derived from the append-only Event Log.

```bash
issueflow timeline show --issue 17
```

---

### `replay` — session replay

Reconstructs a completed workflow session from persisted telemetry and agent snapshots.

```bash
issueflow replay show --issue 17
```

---

### `worktrees` — worktree metadata

IssueFlow persists metadata about all worktrees it manages in SQLite (`~/.issueflow/state.db`).

```bash
issueflow worktrees list
issueflow worktrees drift    # compare git worktrees with persisted metadata
```

---

## Knowledge Base

Place Markdown files under `.issueflow/knowledge/` to inject repo-specific conventions into every agent at spawn time. Common files:

| File | Purpose |
|------|---------|
| `build.md` | How to build the project |
| `test.md` | How to run tests |
| `deploy.md` | Deployment instructions |
| `conventions.md` | Code style and naming conventions |

---

## ADR injection

Architecture Decision Records under `docs/adr/` are loaded and injected into planner and team agents at spawn time. This keeps agent decisions consistent with documented architectural choices.

---

## Worktree setup hook

After creating or attaching a worktree, `issueflow start` runs `scripts/setup-new-worktree.sh` from that worktree when the script exists. The hook receives `MAIN_REPO_ROOT` pointing at the main checkout. Existing reused worktrees skip this hook.

---

## Event Log

IssueFlow writes an append-only Event Log to `~/.issueflow/state.db` (SQLite). All agent lifecycle events, state transitions, team starts/stops, and verification runs are recorded there. `timeline` and `replay` read from this log.

---

## Host integrations

Pre-built integration assets live under `integrations/`:

| Path | Purpose |
|------|---------|
| `integrations/skills/issueflow-workflow/SKILL.md` | Codex skill |
| `integrations/claude/commands/issueflow.md` | Claude Code slash command |
| `integrations/cursor/commands/issueflow.md` | Cursor command |

See [docs/host-integrations.md](docs/host-integrations.md) for installation instructions.

---

## Local development

```bash
npm install
npm test
npm run build
```
