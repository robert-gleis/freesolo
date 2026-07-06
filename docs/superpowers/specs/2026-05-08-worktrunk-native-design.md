# Worktrunk-Native Freesolo Design

## Context

`freesolo start` currently manages workspaces with direct `git worktree` commands. It computes sibling worktree paths, creates issue branches from `origin/main`, attaches existing branches to new worktrees, optionally runs `scripts/setup-new-worktree.sh`, writes session artifacts, and launches the selected host tool.

This project is primarily a personal tool, so it can require Worktrunk instead of maintaining both direct `git worktree` and Worktrunk flows. Worktrunk should become the supported worktree backend and the source of truth for worktree placement.

## Goals

- Require the `wt` CLI for `freesolo start`.
- Use Worktrunk commands for workspace creation and switching.
- Let Worktrunk determine checkout paths according to its configuration.
- Keep freesolo's issue picker, branch naming, setup hook, session state, issue packet, artifact discovery, and host launch behavior.
- Update print-only output and docs so users see Worktrunk commands, not raw `git worktree add` commands.

## Non-Goals

- Support a fallback plain `git worktree` backend.
- Reimplement Worktrunk list, switch, merge, or remove behavior.
- Change host adapters for Codex, Claude, or Cursor beyond passing them the resolved Worktrunk checkout path.
- Change issue branch naming beyond preserving the existing `issue/<number>-<slug>` convention and numeric suffix behavior for collisions.

## User Flow

When a user runs `freesolo start`, freesolo checks that `wt` is available. If it is missing, the command fails with a clear install hint.

After the user chooses an issue, freesolo looks for an existing issue branch or worktree. If a matching worktree exists, freesolo asks whether to reuse it. If a matching branch exists without an attached worktree, freesolo asks whether to switch to that branch through Worktrunk. If the user declines either reuse path, freesolo creates a suffixed issue branch through Worktrunk.

For a new issue branch, freesolo runs `wt switch --create <branch>`. For an existing branch without a current worktree, freesolo runs `wt switch <branch>`. After Worktrunk completes, freesolo resolves the branch's checkout path from the repository's worktree state and uses that path for all subsequent work.

The optional setup hook still runs from the resolved checkout path. `MAIN_REPO_ROOT` still points at the source checkout where the command started.

## Architecture

### Worktrunk Dependency

Add a small dependency check around `wt`.

- `ensureWorktrunkAvailable()` executes `wt --version` or an equivalent lightweight command.
- If the command is missing, throw a dedicated error with an install hint.
- `startAction` catches that error and exits with status 1.

### Workspace Operations

Replace direct creation and attach helpers with Worktrunk-native helpers:

- `switchNewIssueWorktree(repoRoot, branchName)` runs `wt switch --create <branchName>` from `repoRoot`.
- `switchExistingIssueWorktree(repoRoot, branchName)` runs `wt switch <branchName>` from `repoRoot`.
- `resolveBranchWorktreePath(repoRoot, branchName)` reads `git worktree list --porcelain` and returns the worktree path for the branch.

The existing branch/worktree discovery functions can continue to use git because they are read-only repository state queries, not a second worktree backend.

### Path Resolution

Freesolo no longer assumes `/<repo>-<issue>-<slug>` for worktrees created or switched by Worktrunk. It may still compute a candidate path for collision checks in print-only mode, but real launches must resolve the path after `wt switch`.

If Worktrunk succeeds but the branch path cannot be found, freesolo fails with a clear error explaining that it could not resolve the Worktrunk checkout for the branch.

### Print-Only Mode

`--print-only` must show the Worktrunk commands that would run:

- `wt switch --create <branchName>` for new branches.
- `wt switch <branchName>` for existing branches.

Because print-only does not execute Worktrunk, it cannot know the final Worktrunk path unless an existing worktree is already present. In that case, print-only uses the known path. Otherwise it presents the intended branch and a note that the worktree path will be resolved by Worktrunk when executed.

### Setup Hook

`scripts/setup-new-worktree.sh` remains optional. It runs only after Worktrunk creates or attaches a checkout and only when the script exists in the resolved checkout.

Existing reused worktrees continue to skip setup.

## Error Handling

- Missing `wt`: fail with an install hint.
- Worktrunk command failure: surface the captured command failure output.
- Worktrunk succeeds but no matching branch checkout is found: fail with a path resolution error.
- Setup hook failure: keep the existing captured-output `WorktreeSetupError` behavior.
- Prompt cancellation: keep the existing `Cancelled.` behavior.

## Testing

Add or update tests for:

- Missing Worktrunk dependency fails before workspace mutation.
- Print-only emits `wt switch` commands.
- New issue branch flow calls the Worktrunk create helper and then resolves the branch path.
- Existing branch flow calls the Worktrunk switch helper and then resolves the branch path.
- Session state, issue packets, artifact lookup, and launch plans use the resolved Worktrunk checkout path.
- Existing worktree reuse continues to skip setup and use the existing path.
- README prerequisites and worktree setup documentation mention Worktrunk as required.

## Documentation

Update the README prerequisites to include Worktrunk. Update the worktree setup section to explain that freesolo delegates checkout creation and path placement to Worktrunk, while still running the optional setup hook after Worktrunk creates or switches to a checkout.
