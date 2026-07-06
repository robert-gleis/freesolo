# FreeSolo

FreeSolo is the control plane that turns GitHub issues into shipped pull requests by orchestrating teams of agents through an explicit, persisted workflow.

## Language

### Orchestration

**Factory**:
The FreeSolo system as a whole — the autonomous software factory that consumes issues and produces merged PRs.
_Avoid_: System, Platform.

**Workflow Engine**:
The central orchestrator that enforces state transitions, drives execution, and is the single source of truth for workflow progress. A component _inside_ the Factory.
_Avoid_: Controller, Scheduler, Orchestrator (when referring to this specific component).

**Workflow**:
The end-to-end process for a single issue from triage to merged.
_Avoid_: Pipeline, Job, Run.

**Session**:
An active agent instance working in a worktree. Has its own stage, review-loop counters, and artifact references.
_Avoid_: Run, Job (a session is per-agent-per-worktree, not per-issue).

### Agents

**Host**:
A concrete agent runtime that FreeSolo can drive: Codex, Claude Code, Cursor Agent, Pi. The CLI flag is `--tool`, the type is `HostTool` in code.
_Avoid_: Backend, Harness, Tool (in conversation about agent products).

**Adapter**:
The translation layer between the Workflow Engine and one specific Host. Today expressed as `LaunchPlanBuilder`; #33 introduces a richer lifecycle interface (start/stop/send/status).
_Avoid_: Driver, Plugin, Connector.

**Runner**:
The translation layer for the _execution environment_ (tmux, local process, Docker container) — orthogonal to Adapter. An Adapter chooses _which_ host binary to launch; a Runner chooses _how_ to launch it.
_Avoid_: Executor, Launcher.

**Agent**:
A single running instance of a Host with an explicit role assigned by the Workflow Engine. One Agent has one Host and one Runner.
_Avoid_: Worker, Bot.

**Team**:
A group of Agents with distinct roles working on the same issue. Composition is decided by the Planner Agent.
_Avoid_: Crew, Squad, Group.

### Workspace

**Worktree**:
A git worktree owned by FreeSolo, scoped to one issue or team. Created and placed by Worktrunk (`wt`); lifecycle is tracked centrally.
_Avoid_: Workspace, Checkout, Clone.

### Memory

**ADR**:
An Architecture Decision Record under `docs/adr/`. Human-written, intended for hard-to-reverse decisions only. Format: see `docs/adr/ADR-FORMAT.md`.
_Avoid_: Decision (in isolation — say ADR when you mean the formal record).

**Knowledge Base**:
Repo-specific operational knowledge under `.freesolo/knowledge/*.md` — conventions, build/test/deploy commands. Injected into agent context at spawn.
_Avoid_: Docs, Wiki, Notes.

**Event Log**:
Append-only, queryable telemetry of agent and workflow lifecycle events. Lives in SQLite at `~/.freesolo/state.db`. High-frequency, machine-written.
_Avoid_: Audit Log, Activity Log, History (when referring to this specific store).

### Verification

**Verification Gate**:
The hard, engine-enforced gate that blocks PR creation until verification passes. Agents cannot self-certify past it.
_Avoid_: Check, Approval (those refer to the human override step, which is different).

**Review**:
The agent-driven review phase that produces a `REVIEW_REPORT.md` artifact. Distinct from the human PR review.
_Avoid_: PR Review (use that phrase explicitly when the human review on GitHub is meant).
