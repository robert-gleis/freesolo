# Agent Review Loop Design

## Context

Freesolo currently guides agents through a linear workflow with one plan review gate and one implementation review gate. Each gate is a single separate review agent pass. That catches obvious issues, but it does not guide the workflow through repeated review and fix cycles when the reviewer finds actionable problems.

The new behavior should make both review gates iterative. A reviewer agent reviews the current work, writes findings, and hands those findings to a separate fixer agent. After the fixer applies changes, a fresh reviewer agent reviews the result again. The loop repeats until a reviewer passes with no findings or the workflow reaches a maximum of 5 rounds.

## Goals

- Apply the review/fix loop to both the plan review gate and the implementation review gate.
- Put deterministic loop mechanics in a reusable skill script where Codex and Claude Code can call the same freesolo skill.
- Use a fresh reviewer agent for every review round.
- Use a separate fixer agent when findings need to be addressed.
- Exit the loop only when the reviewer passes with no findings.
- Cap each review loop at 5 rounds.
- If findings remain after round 5, mark the gate blocked and stop for user intervention.
- Keep older single-review artifacts readable so existing freesolo sessions do not break.

## Non-Goals

- The CLI will not directly orchestrate spawned agents in this change.
- The skill script will not directly call model-specific spawn-agent tools. It will produce the next reviewer or fixer action for the active agent to execute.
- Host-specific command assets may remain as convenience wrappers, but the review loop behavior should live in the shared skill.
- The workflow will not merge the reviewer and fixer responsibilities into one agent.
- The loop will not proceed past a gate with unresolved findings.

## Workflow

Both review gates use the same loop:

1. Start round 1 for the active gate.
2. Use the freesolo skill script to determine the current round, review artifact path, and reviewer prompt.
3. Spawn a reviewer agent for the current artifact under review.
4. The reviewer writes a round-specific review artifact.
5. Record the review result through the skill script.
6. If the review passes with no findings, mark the gate as passed and continue to the next stage.
7. If the review has findings, use the skill script to produce the fixer handoff, then spawn a separate fixer agent with the review artifact and relevant source artifacts as input.
8. The fixer applies changes and updates the relevant artifact or implementation.
9. Start the next round with a fresh reviewer agent.
10. Stop after round 5 if findings remain, mark the gate as blocked, and ask the user how to proceed.

The plan review loop runs after `superpowers:writing-plans` and before implementation. The implementation review loop runs after implementation and before verification.

## Artifacts

New review artifacts should include the round number:

- `docs/freesolo/reviews/YYYY-MM-DD-issue-<number>-plan-review-round-<round>.md`
- `docs/freesolo/reviews/YYYY-MM-DD-issue-<number>-implementation-review-round-<round>.md`

Artifact discovery should return the latest matching round-specific artifact when present. It should continue to recognize the existing unnumbered files:

- `docs/freesolo/reviews/YYYY-MM-DD-issue-<number>-plan-review.md`
- `docs/freesolo/reviews/YYYY-MM-DD-issue-<number>-implementation-review.md`

The startup packet can still expose one latest plan review path and one latest implementation review path. The round number belongs in the artifact name and session state.

## Session State

The existing review gate statuses remain:

- `pending`
- `pass`
- `pass_with_findings`
- `block`

For review loops, only `pass` exits the gate. `pass_with_findings` means the reviewer found actionable issues, so the workflow must run the fixer agent and continue to the next round unless the gate has already reached round 5.

Each gate should additionally track the active round and maximum rounds. A compact shape is enough:

```json
{
  "reviewLoops": {
    "plan": {
      "currentRound": 1,
      "maxRounds": 5
    },
    "implementation": {
      "currentRound": 1,
      "maxRounds": 5
    }
  }
}
```

Existing session files without `reviewLoops` must remain valid, defaulting both gates to round 1 of 5.

## Shared Skill Script

The freesolo workflow should have a shared skill directory that can be installed by hosts that support skills, including Codex and Claude Code. The script should live under:

- `integrations/skills/freesolo-workflow/scripts/review-loop.mjs`

The script owns the deterministic loop behavior:

- locate `freesolo/session.json` through `git rev-parse --git-path freesolo/session.json`
- validate the requested gate, either `plan` or `implementation`
- read or default `reviewLoops`
- report the current round and max rounds
- print the expected review artifact path for the current round
- print a reviewer handoff prompt for a fresh reviewer agent
- record review outcomes as `pass`, `pass_with_findings`, or `block`
- when findings exist and rounds remain, increment the round and print a fixer handoff prompt
- when findings exist after round 5, mark the gate as `block` and tell the active agent to stop for user input

The script should be deterministic and local-file based. It should not depend on a particular model provider or attempt to spawn agents by itself.

The existing Codex skill asset should move to the shared skill directory. Claude can then use the same skill instead of duplicating the loop script in a command asset. Cursor can keep a command-style asset if it does not support this skill format.

## Kernel and Integrations

The shared workflow kernel and reusable host assets should describe the new stage order:

1. Issue Intake
2. Brainstorming with `superpowers:brainstorming`
3. Spec
4. User Review Gate
5. Plan with `superpowers:writing-plans`
6. Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
7. Implementation with `superpowers:test-driven-development`
8. Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
9. Verification with `superpowers:verification-before-completion`

The instructions must say that review gates are passed only when a fresh reviewer finds no findings. They must also say not to proceed after round 5 if findings remain.

## Testing

Unit tests should cover:

- The workflow kernel mentions both review/fix loops and the 5-round cap.
- Session state accepts the new `reviewLoops` shape.
- Session state remains compatible with existing files if defaults are added by parser logic.
- Artifact discovery prefers the latest numbered review artifact.
- Artifact discovery still accepts old unnumbered review artifact names.
- The shared skill script prints reviewer and fixer handoffs, advances rounds, and blocks after round 5.
- Host integration assets mention separate reviewer and fixer agents and the 5-round cap.

Integration tests should confirm that `freesolo start` writes initialized loop state for both gates and includes the loop instructions in the startup prompt.

## Open Decisions

No open decisions remain. Both plan review and implementation review use the same fresh-reviewer, separate-fixer loop with a maximum of 5 rounds.
