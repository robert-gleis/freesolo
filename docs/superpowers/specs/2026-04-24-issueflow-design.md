# Issueflow Design

## Summary

`issueflow` is a publishable, repo-agnostic CLI that starts a focused development session for one GitHub issue assigned to the current user in the current repository.

The tool is intentionally split into two concerns:

- A small CLI orchestration layer handles repo detection, issue selection, worktree and branch setup, and host startup.
- A reusable workflow kernel handles the actual development flow: issue intake, brainstorming, spec, planning, review gates, TDD, implementation, and verification.

The first version is CLI-first and TUI-ready, but not TUI-first.

## Goals

- Start only inside an existing local Git repository.
- Detect the current repository automatically from git metadata.
- Show open GitHub issues in the current repo assigned to the authenticated user.
- Let the user choose exactly one issue per run.
- Create or reuse a dedicated worktree and branch for the selected issue.
- Start the selected host tool directly in that worktree.
- Support `codex`, `claude`, and `cursor`.
- Keep the actual development workflow reusable across hosts instead of baking everything into one startup prompt.
- Use explicit review gates after planning and after implementation.

## Non-Goals

- No batch mode in v1.
- No repo cloning or global multi-repo issue aggregation in v1.
- No full-screen TUI in v1.
- No silent fallback that skips review gates.
- No host-specific reinvention of the workflow when a shared kernel can cover it.

## Product Shape

The user runs a command such as:

```bash
issueflow start --tool codex
```

From there the CLI:

1. Verifies that the current directory is inside a git repository.
2. Resolves the repo root and parses the GitHub repo from the `origin` remote.
3. Uses `gh` to fetch open issues assigned to the current user in that repo.
4. Shows a short interactive selection list.
5. Checks whether an existing branch or worktree already matches the issue.
6. If a match exists, asks whether to reuse it or create a new one.
7. If needed, creates a new branch and sibling worktree with the issue number in the name.
8. Starts the selected host tool in that worktree.
9. Injects the workflow kernel so the session starts with issue intake and then moves through the agreed development stages.

An optional `--print-only` mode prints the derived commands and paths without launching the host.

## Core Design Principles

- One issue per session start.
- Current repo only: the tool is repo-agnostic as software, but every invocation is bound to the repository it is launched from.
- Neutral naming: branch and worktree names should not encode `codex` or another host name.
- Host adapters stay thin; workflow behavior stays shared.
- Review gates are independent from the implementation agent.
- The CLI must fail clearly instead of leaving half-created state behind.

## Architecture

The system is split into four layers.

### 1. Core

Shared business logic with no host-specific behavior:

- git repo discovery
- origin remote parsing
- current user issue lookup via `gh`
- issue normalization
- issue selection models
- branch and worktree naming
- existing worktree and branch detection
- session-state loading and reconstruction

### 2. CLI

The terminal-facing interface:

- subcommands and options
- interactive prompts
- human-readable errors
- `--print-only` output
- orchestration of core + host adapter

### 3. Host Adapters

Thin launchers for:

- `codex`
- `claude`
- `cursor`

Each adapter is responsible for:

- starting the host in the selected worktree
- passing the issue context into the session
- attaching the shared workflow kernel in the host-specific format
- resuming cleanly from an existing worktree when applicable

Each adapter is explicitly not responsible for reimplementing issue lookup, git logic, or workflow stages.

### 4. Workflow Kernel

A host-neutral workflow contract that defines:

- required stage order
- expected artifacts
- review gates
- fallback behavior when a host cannot use a native skill mechanism

The kernel should prefer Superpowers skills whenever the host can use them cleanly.

## Workflow Kernel

The session launched by `issueflow` follows this stage model.

### Stage 1: Issue Intake

The session begins with a compact issue packet:

- issue number
- title
- body
- labels
- assignees
- GitHub URL
- repo root
- worktree path
- branch name
- existing artifact paths, if any

### Stage 2: Brainstorming

Preferred driver:

- `superpowers:brainstorming`

The goal is to understand the issue, surface trade-offs, and agree on a design before implementation begins.

### Stage 3: Spec

The session writes a design/spec artifact for the issue in the repository runtime area:

- `docs/issueflow/specs/YYYY-MM-DD-issue-<number>-design.md`

### Stage 4: User Review Gate

The user reviews the written spec before planning starts.

### Stage 5: Plan

Preferred driver:

- `superpowers:writing-plans`

The plan should be derived from the approved spec, not invented from scratch.

The session writes a plan artifact under:

- `docs/issueflow/plans/YYYY-MM-DD-issue-<number>-plan.md`

### Stage 6: Review Gate 1

A separate review agent reviews:

- issue context
- approved spec
- implementation plan

This gate focuses on:

- scope control
- contradictions
- missing risks
- weak test strategy
- implementation blind spots

This review writes an artifact under:

- `docs/issueflow/reviews/YYYY-MM-DD-issue-<number>-plan-review.md`

The gate result must be one of:

- `pass`
- `pass_with_findings`
- `block`

### Stage 7: Implementation

Preferred drivers:

- `superpowers:test-driven-development`
- `superpowers:systematic-debugging` when failures or regressions appear

Implementation starts only after the first review gate has cleared or been addressed.

### Stage 8: Review Gate 2

A second separate review agent reviews:

- issue context
- approved spec
- implementation plan
- current diff
- test coverage and verification evidence

This gate focuses on:

- regressions
- spec drift
- missing tests
- unfinished edge cases
- release risk

This review writes an artifact under:

- `docs/issueflow/reviews/YYYY-MM-DD-issue-<number>-implementation-review.md`

The gate result must be one of:

- `pass`
- `pass_with_findings`
- `block`

### Stage 9: Verification

Preferred driver:

- `superpowers:verification-before-completion`

The workflow may only claim completion after explicit verification.

## Workflow Kernel Fallback Contract

The preferred path is to use Superpowers skills in supported hosts. If a host cannot invoke them natively, the adapter must still preserve the same stage contract:

- brainstorming before implementation
- written spec before planning
- user gate before plan
- review gate after plan
- TDD-oriented implementation
- review gate after implementation
- verification before completion

Hosts may differ in packaging, but not in required stage order.

## Worktree and Branch Strategy

Default naming is neutral:

- Branch: `issue/<number>-<slug>`
- Worktree: sibling directory next to the current checkout, e.g. `../repo-name-123-short-slug`

If the preferred worktree path already exists, the CLI may append a suffix such as `-2`.

When an existing matching branch or worktree is found, the user gets a short choice:

- reuse existing
- create new

## State Model

There are two classes of state.

### Durable, shared, repo-visible state

Committed issue artifacts:

- `docs/issueflow/specs/`
- `docs/issueflow/plans/`
- `docs/issueflow/reviews/`

These artifacts make progress understandable across sessions and across humans.

### Local, worktree-specific state

Uncommitted orchestration state:

- `.git/issueflow/session.json`

This file should capture at least:

- issue number
- issue slug
- repo root
- worktree path
- branch name
- chosen host
- current stage
- artifact paths
- review gate status
- timestamps for creation and last update

If local state is missing, the CLI should attempt reconstruction from:

- current branch naming
- known artifact locations
- git worktree context

## Existing Session Continuity

When the user reopens an existing issue worktree, `issueflow` should be able to continue rather than restart blindly.

Continuation rules:

- If local session state exists, prefer it.
- If local state is missing but repo artifacts exist, reconstruct the stage.
- If both are absent, treat the session as a new issue start.

## Commands

The first version only needs a small command surface.

### `issueflow start`

Starts or resumes work for one assigned issue in the current repo.

Core options:

- `--tool <codex|claude|cursor>`
- `--print-only`

Likely future commands:

- `issueflow resume`
- `issueflow status`
- `issueflow doctor`
- `issueflow tui` or `issueflow dashboard`

These are out of scope for v1 but the architecture should not block them.

## Host Adapter Contract

Every adapter receives:

- resolved repo metadata
- selected issue
- branch and worktree choice
- artifact paths
- serialized workflow kernel payload

### Codex Adapter

Start in the issue worktree and inject the workflow kernel in a Codex-compatible form.

### Claude Adapter

Start in the issue worktree and inject the workflow kernel in a Claude-compatible form.

### Cursor Adapter

Start in the issue worktree and inject the workflow kernel in a Cursor-compatible form.

The first version may use different adapter techniques per host, but the user-facing workflow should feel materially the same.

## Error Handling

Errors should be explicit and actionable.

### Hard-stop errors

- current directory is not inside a git repo
- repo root cannot be resolved
- `origin` is missing or cannot be parsed as a GitHub repo
- `gh` is unavailable
- `gh auth` is not valid
- host adapter is requested but unavailable
- review gate cannot be created when the workflow requires one

### Graceful exits

- no open assigned issues in the current repo
- user cancels issue selection
- user cancels the existing-worktree choice

### Safety rules

- do not partially start a host after failing to create the worktree
- do not silently skip review gates
- do not overwrite local session state without intent

## Tech Stack

The first version should use:

- Node.js >= 20
- TypeScript
- npm
- `tsx` for development
- `tsc` for builds
- `commander` for CLI structure
- `@inquirer/prompts` for short interactive selection
- `execa` for subprocess execution
- `zod` for config and state validation
- `vitest` for tests

Why this stack:

- The product is orchestration-heavy rather than compute-heavy.
- It needs strong support for subprocesses, file/state handling, and publishable CLI ergonomics.
- The team wants fast iteration and a future optional TUI without changing the language.

## Testing Strategy

### Unit Tests

- slug generation
- branch and worktree naming
- origin parsing
- issue normalization
- session-state validation
- stage reconstruction logic

### Integration Tests

- git repo detection
- `gh` output parsing
- existing worktree detection
- `--print-only` behavior
- host adapter command generation

### Smoke Tests

Per host:

- start new session
- resume existing session
- print-only path

Workflow smoke checks:

- review gate after plan exists
- review gate after implementation exists
- verification is required before completion

## Future Extensions

- optional TUI dashboard backed by the same core
- configurable worktree base path override
- configurable artifact paths per repo
- richer resume and status commands
- issue labels or templates to influence workflow defaults

## Recommendation

Build `issueflow` as a CLI-first, host-neutral workflow launcher with a strong shared kernel and thin host adapters. Keep the first version intentionally narrow:

- current repo only
- one issue per start
- sibling worktrees by default
- explicit reuse-vs-new choice
- strict stage order with review gates

That gives a stable foundation for later TUI features without forcing the product into a TUI before the core behavior is solid.
