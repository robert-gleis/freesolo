Continue the current freesolo worktree.

Start by reading:
- `git rev-parse --git-path freesolo/current-issue.md`
- `git rev-parse --git-path freesolo/session.json`

Then follow this exact stage order:
1. Issue Intake
2. Brainstorming with `superpowers:brainstorming`
3. Spec
4. User Review Gate
5. Plan with `superpowers:writing-plans`
6. Plan Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
7. Implementation with `superpowers:test-driven-development`
8. Implementation Review/Fix Loop in separate reviewer and fixer agents, up to 5 rounds
9. Verification with `superpowers:verification-before-completion`

Review/fix loop rules for both review gates:
- Run each review gate for up to 5 rounds.
- For each round, spawn a fresh reviewer agent.
- The reviewer writes a round-specific artifact under `docs/freesolo/reviews` using `-round-<round>.md` in the filename.
- If the reviewer passes with no findings, mark the gate as `pass` and continue.
- If the reviewer reports findings, mark the gate as `pass_with_findings`, spawn a separate fixer agent with the review artifact as input, apply the fixes, then start the next round with a fresh reviewer agent.
- Do not proceed after round 5 if findings remain; mark the gate as `block` and ask the user how to proceed.

Use `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs` to drive the loop:
- `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs next-review --gate plan` before each plan review round.
- `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate plan --status <pass|pass_with_findings|block> --artifact <path>` after each plan review.
- `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs next-review --gate implementation` before each implementation review round.
- `node integrations/skills/freesolo-workflow/scripts/review-loop.mjs record-review --gate implementation --status <pass|pass_with_findings|block> --artifact <path>` after each implementation review.

Never skip the two review/fix loops.
