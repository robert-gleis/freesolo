---
description: Continue the current issueflow worktree using the shared issue packet and strict review-gated workflow
allowed-tools: Bash(cat:*), Bash(git status:*), Bash(ls:*), Read, Edit, MultiEdit, Write
---

## Context

- Issue packet: !`cat "$(git rev-parse --git-path issueflow/current-issue.md)"`
- Session state: !`cat "$(git rev-parse --git-path issueflow/session.json)"`
- Git status: !`git status --short`

## Task

Continue the issueflow workflow in this order:
1. Issue Intake
2. Brainstorming with `superpowers:brainstorming`
3. Spec
4. User Review Gate
5. Plan with `superpowers:writing-plans`
6. Review Gate 1 in a separate review agent
7. Implementation with `superpowers:test-driven-development`
8. Review Gate 2 in a separate review agent
9. Verification with `superpowers:verification-before-completion`

Never skip Review Gate 1 or Review Gate 2.
