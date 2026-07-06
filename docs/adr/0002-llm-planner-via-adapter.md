# Meta-decisions run through an LLM planner via AgentAdapter

Autonomous workflow decisions (issue decomposition, team composition, agent-backend selection) are produced by an **LLM planner agent** that itself runs through the standard `AgentAdapter` interface, with structured JSON output. The system dogfoods its own adapter abstraction for meta-decisions rather than introducing a separate decision engine.

## Considered Options

- **Heuristics / rules** (token counts, label matching) — rejected: real-world issues are unstructured and brittle rules drift quickly out of date.
- **LLM call via a direct SDK**, bypassing `AgentAdapter` — rejected: breaks the abstraction symmetry; the Workflow Engine would talk to two different agent transports.
- **Hybrid (heuristic gate, then LLM)** — rejected for now as premature; can be added later if cost or latency become real constraints.

## Consequences

- The planner produces a structured `TeamDefinition` / `DecompositionPlan` JSON consumable by the Team Lifecycle Manager. Schemas are owned by the Planner ticket.
- Planner output is treated as a *proposal*. Human override happens at the `planned → approved` state transition (see CLI commands `freesolo plan show/edit/approve`). Autonomous mode skips the human step but the approval is recorded in the Event Log as a `team.planned` event.
- The planner is replaceable: any AgentAdapter-conformant host (Pi, Claude Code, Codex, Cursor) can drive it.
