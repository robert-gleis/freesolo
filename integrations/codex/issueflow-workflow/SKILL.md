---
name: issueflow-workflow
description: Use when continuing work from an issueflow worktree. Resolve the issueflow state files with git rev-parse and follow the full issueflow stage order with review gates.
---

1. Resolve the state files with `git rev-parse --git-path issueflow/current-issue.md` and `git rev-parse --git-path issueflow/session.json`.
2. Read the issue packet and session state before making changes.
3. Continue the stage order exactly:
   - Issue Intake
   - Brainstorming with `superpowers:brainstorming`
   - Spec
   - User Review Gate
   - Plan with `superpowers:writing-plans`
   - Review Gate 1 in a separate review agent
   - Implementation with `superpowers:test-driven-development`
   - Review Gate 2 in a separate review agent
   - Verification with `superpowers:verification-before-completion`
4. Never skip Review Gate 1 or Review Gate 2.
5. If the issue packet is missing, stop and ask the user to run `issueflow start`.
