# Host integrations

The reusable assets live in `integrations/` so they can be committed, reviewed, and copied into a host installation when needed.

## Prerequisites

- `issueflow` checked out locally
- `git` available in the host environment
- Worktrunk (`wt`) installed
- The host you want to use: Codex, Claude, or Cursor
- `cursor-agent` available if you want `issueflow start --tool cursor` to launch the Cursor adapter directly

## Codex

Copy `integrations/codex/issueflow-workflow/SKILL.md` into your Codex skills directory as `issueflow-workflow/SKILL.md`.

If your Codex installation uses a different skills path, keep the directory name `issueflow-workflow` and place the file wherever Codex loads custom skills from.

## Claude

Copy `integrations/claude/commands/issueflow.md` into `.claude/commands/issueflow.md` in the repository where you want the slash command to be available.

Project-level custom commands are the simplest option when you want the command to travel with the repo.

## Cursor

Copy `integrations/cursor/commands/issueflow.md` into `.cursor/commands/issueflow.md` in the repository where you want the command to be available.

If you prefer a user-level install, place the command in the matching Cursor commands directory for your machine.

## What the assets do

Each host asset:

- resolves the shared state files with `git rev-parse --git-path issueflow/current-issue.md`
- resolves the local session state with `git rev-parse --git-path issueflow/session.json`
- preserves the stage order from issue intake through verification
- keeps both review gates in place

## Quick check

After installing an asset, open the host and confirm that the issueflow command or skill mentions the shared state paths and both review gates before you rely on it for a session.
