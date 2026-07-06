---
name: freesolo-workflow
description: Use when continuing work from an freesolo worktree. Resolve the freesolo state files with git rev-parse and follow the full freesolo stage order with review/fix loops.
---

1. Resolve the state files with `git rev-parse --git-path freesolo/current-issue.md` and `git rev-parse --git-path freesolo/session.json`.
2. Read the issue packet and session state before making changes.
3. Continue the stage order exactly:
   - Issue Intake
   - Brainstorming with `superpowers:brainstorming`
   - Spec
   - User Review Gate
   - Plan with `superpowers:writing-plans`
   - Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
   - Implementation with `superpowers:test-driven-development`
   - Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
   - Verification with `superpowers:verification-before-completion`
4. For hosts that support skills, use the skill script for review loop bookkeeping:
   - Run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs next-review --gate plan` before each plan review round.
   - After a plan review with findings, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate plan --status pass_with_findings --artifact docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md`.
   - After a clean plan review, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate plan --status pass --artifact docs/freesolo/reviews/2026-04-24-issue-12-plan-review-round-1.md`.
   - Run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs next-review --gate implementation` before each implementation review round.
   - After an implementation review with findings, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate implementation --status pass_with_findings --artifact docs/freesolo/reviews/2026-04-24-issue-12-implementation-review-round-1.md`.
   - After a clean implementation review, run `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate implementation --status pass --artifact docs/freesolo/reviews/2026-04-24-issue-12-implementation-review-round-1.md`.
5. Review/fix loop rules for both review gates:
   - Run each review gate for up to 5 rounds.
   - For each round, spawn a fresh reviewer agent.
   - The reviewer writes a round-specific artifact under `docs/freesolo/reviews` using `-round-<round>.md` in the filename.
   - If the reviewer passes with no findings, mark the gate as `pass` and continue.
   - If the reviewer reports findings, mark the gate as `pass_with_findings`, spawn a separate fixer agent with the review artifact as input, apply the fixes, then start the next round with a fresh reviewer agent.
   - Do not proceed after round 5 if findings remain; mark the gate as `block` and ask the user how to proceed.
6. Never skip the two review/fix loops.
7. If the issue packet is missing, stop and ask the user to run `freesolo start`.
