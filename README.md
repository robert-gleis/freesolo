# freesolo

**FreeSolo** is the control plane that turns GitHub issues into shipped pull requests by orchestrating teams of agents through an explicit, persisted workflow — the autonomous software factory.

## How it works

FreeSolo drives every issue through a fixed state machine:

```
triaged → planned → approved → implementing → reviewing → verifying → pr-ready → merged → closed
```

State is stored locally under `~/.freesolo/state/`, so FreeSolo never writes workflow labels back to GitHub. From triage to merge, every step is enforced by the Workflow Engine; agents cannot skip or self-certify past gates.

## Prerequisites

- **Node.js 20+**
- **`gh`** — GitHub CLI, installed and authenticated
- **Worktrunk (`wt`)** — FreeSolo delegates worktree creation and placement to Worktrunk
- **At least one supported host** — Codex, Claude Code, or Cursor Agent (`cursor-agent`)
- **`better-sqlite3`** — installed automatically via `npm install`

## Installation

```bash
git clone <repo>
cd freesolo
npm install
npm run build
npm link          # makes `freesolo` available globally
```

After pulling updates:

```bash
npm install       # only when dependencies changed
npm run build
```

If the global link ever points at an old clone:

```bash
npm unlink -g freesolo
npm link
which freesolo
freesolo --help
```

## Quick start

As a human you only need two commands. Everything else in the reference below is plumbing for agents and the engine.

```bash
freesolo plan 42                # initialise → generate team plan → approve (add --edit to review in $EDITOR first)
freesolo work 42 --tool claude  # worktree + branch → autonomous worker in tmux → review/lint/test gate → PR
```

`freesolo work` runs one issue end-to-end:

1. Creates (or reuses) a dedicated worktree and `issue/<n>-<slug>` branch via Worktrunk.
2. Starts the worker agent in a detached tmux session named `freesolo-<n>` — attach any time with `tmux attach -t freesolo-<n>`, or just let it run.
3. When the worker exits, runs the gate route from `freesolo.config.json`: a fresh review agent, then lint/test shell checks; every red attempt spawns a fresh fixer agent and reruns the route, up to `maxAttempts` (set it to 5). Fresh context per agent, by design.
4. Still red after the cap → it stops and tells you manual input is required (with the run artifacts). Green → pushes the branch and opens the PR.

Alternatively, pick up the next assigned issue and launch your preferred host in a dedicated worktree:

```bash
freesolo start --tool claude
freesolo start --tool codex
freesolo start --tool cursor
freesolo start --tool claude --print-only   # preview without launching
```

`freesolo start` reads the current issue from the worktree's `freesolo/current-issue.md` (written by Worktrunk). It creates or reattaches the worktree, then runs `scripts/setup-new-worktree.sh` when that script exists in the repo.

---

## Full command reference

### `state` — inspect and advance workflow state

```bash
freesolo state get --issue 17
# prints current state, or "null" with exit code 2 when no workflow state exists

FREESOLO_ENGINE=1 freesolo state transition --issue 17 --to planned
```

The `FREESOLO_ENGINE=1` environment variable is required for all state-mutating commands so that agent processes cannot bypass the engine.

---

### `plan` — team planning

Generates a `team-plan.json` in the worktree that describes which agent roles should work on the issue. Transitions the issue `triaged → planned → approved`.

```bash
# 1. Generate a team plan via the LLM planner
FREESOLO_ENGINE=1 freesolo plan generate --issue 17

# 2. Inspect the generated plan
freesolo plan show --issue 17

# 3. Edit the plan manually before approval
freesolo plan edit --issue 17

# 4. Validate and approve — transitions planned → approved
FREESOLO_ENGINE=1 freesolo plan approve --issue 17
```

ADRs from `docs/adr/` and Knowledge Base files from `.freesolo/knowledge/` are injected automatically into the planner's context.

---

### `decomposition` — issue decomposition

For large issues, FreeSolo can decompose an issue into smaller child issues on GitHub.

```bash
# Generate a decomposition preview (does not create issues yet)
freesolo decomposition generate --issue 17

# Inspect the preview
freesolo decomposition show --issue 17

# Edit the preview in $EDITOR
freesolo decomposition edit --issue 17

# Approve: validates the preview and creates child issues on GitHub
FREESOLO_ENGINE=1 freesolo decomposition approve --issue 17
```

---

### `team` — agent team lifecycle

Creates and manages a team of agents derived from `team-plan.json`. Transitions the issue `approved → implementing`.

```bash
# Start the team — requires FREESOLO_ENGINE=1
FREESOLO_ENGINE=1 freesolo team start --issue 17

# Inspect the running team snapshot
freesolo team status --issue 17

# Cancel a running team
freesolo team stop --issue 17
```

---

### `verify` — verification pipeline

Runs a configurable pipeline of checks against the current repo state. Checks are defined in `freesolo.config.json` at the repo root.

```bash
freesolo verify --issue 17
freesolo verify --issue 17 --bail            # stop after first failure
freesolo verify --issue 17 --print-only      # show the plan without running
freesolo verify --issue 17 --config ./path/to/config.json
```

**`freesolo.config.json` example:**

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
FREESOLO_ENGINE=1 freesolo gate evaluate --issue 17
```

---

### `candidate` — integration branch

When a team works in multiple worktrees, FreeSolo merges the individual branches into a single candidate branch for review.

```bash
FREESOLO_ENGINE=1 freesolo candidate create --issue 17
freesolo candidate show --issue 17
```

---

### `pr` — pull request management

Creates a pull request from the verified candidate branch. Requires the verification gate to have passed.

```bash
FREESOLO_ENGINE=1 freesolo pr create --issue 17
freesolo pr show --issue 17
```

---

### `merge` — merge readiness check

Evaluates whether a pull request is ready to merge (CI status, review approvals, labels) and writes a structured verdict. Optionally syncs a comment to the PR summarising the result.

```bash
FREESOLO_ENGINE=1 freesolo merge evaluate --issue 17
FREESOLO_ENGINE=1 freesolo merge evaluate --issue 17 --merge-method squash
freesolo merge show --issue 17
```

---

### `watch` — autonomous issue watcher

By default, `watch` polls open GitHub issues assigned to the authenticated `gh` user. New issues are confirmed once before intake, then FreeSolo stores workflow state locally and drains accepted issues through the Workflow Engine.

```bash
# Single poll + drain cycle (good for CI/cron)
freesolo watch once

# Continuous loop — graceful shutdown on SIGINT/SIGTERM
FREESOLO_ENGINE=1 freesolo watch run
FREESOLO_ENGINE=1 freesolo watch run --interval 30
FREESOLO_ENGINE=1 freesolo watch run --intake-mode auto
FREESOLO_ENGINE=1 freesolo watch run --source label --trigger-label triaged
```

Configure defaults in `~/.freesolo/config.yaml` (see [Global configuration](#global-configuration)).

---

### `engine` — workflow engine tick

Advance a single issue one step through the workflow engine. Used internally by `watch` and available for scripted orchestration.

```bash
FREESOLO_ENGINE=1 freesolo engine tick --issue 17
```

---

### `reports` — review and test report artifacts

Agents write `TEST_REPORT.md` and `REVIEW_REPORT.md` into the worktree during the reviewing phase. Use this command to inspect them.

```bash
freesolo reports show --issue 17
```

---

### `timeline` — workflow timeline

Renders a human-readable timeline for an issue derived from the append-only Event Log.

```bash
freesolo timeline show --issue 17
```

---

### `replay` — session replay

Reconstructs a completed workflow session from persisted telemetry and agent snapshots.

```bash
freesolo replay show --issue 17
```

---

### `worktrees` — worktree metadata

FreeSolo persists metadata about all worktrees it manages in SQLite (`~/.freesolo/state.db`).

```bash
freesolo worktrees list
freesolo worktrees drift    # compare git worktrees with persisted metadata
```

---

## Knowledge Base

Place Markdown files under `.freesolo/knowledge/` to inject repo-specific conventions into every agent at spawn time. Common files:

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

After creating or attaching a worktree, `freesolo start` runs `scripts/setup-new-worktree.sh` from that worktree when the script exists. The hook receives `MAIN_REPO_ROOT` pointing at the main checkout. Existing reused worktrees skip this hook.

---

## Event Log

FreeSolo writes an append-only Event Log to `~/.freesolo/state.db` (SQLite). All agent lifecycle events, state transitions, team starts/stops, and verification runs are recorded there. `timeline` and `replay` read from this log.

---

## Host integrations

Pre-built integration assets live under `integrations/`:

| Path | Purpose |
|------|---------|
| `integrations/skills/freesolo-workflow/SKILL.md` | Codex skill |
| `integrations/claude/commands/freesolo.md` | Claude Code slash command |
| `integrations/cursor/commands/freesolo.md` | Cursor command |

See [docs/host-integrations.md](docs/host-integrations.md) for installation instructions.

---

## Global configuration

FreeSolo reads `~/.freesolo/config.yaml` on startup. All fields are optional — defaults are used for any missing key.

```yaml
# ~/.freesolo/config.yaml

# Workflow state is persisted locally in
# ~/.freesolo/state/<owner>/<repo>/<issue-number>.
# No GitHub writes are made for state tracking.

# Autonomous watcher defaults (used by `freesolo watch`).
watcher:
  interval_seconds: 60
  source: assigned-to-me
  intake_mode: confirm
  initial_state: triaged
  trigger_label: "triaged"

# Set to true to allow the engine to auto-approve team plans without
# a human review gate.
autonomous_mode: false
```

---

## Local development

```bash
npm install
npm test
npm run build
```
