import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const assetFiles = [
  'integrations/skills/issueflow-workflow/SKILL.md',
  'integrations/claude/commands/issueflow.md',
  'integrations/cursor/commands/issueflow.md'
];

const requiredSnippets = [
  'git rev-parse --git-path issueflow/current-issue.md',
  'git rev-parse --git-path issueflow/session.json',
  'Issue Intake',
  'Brainstorming',
  'Spec',
  'User Review Gate',
  'Plan',
  'Plan Review/Fix Loop',
  'Implementation',
  'Implementation Review/Fix Loop',
  'Verification',
  'fresh reviewer agent',
  'separate fixer agent',
  'up to 5 rounds',
  'Do not proceed after round 5',
  'scripts/review-loop.mjs'
];

describe('host workflow assets', () => {
  it('reference the shared state files and preserve the review-gated stage order', async () => {
    const files = await Promise.all(assetFiles.map((file) => fs.readFile(file, 'utf8')));

    for (const file of files) {
      for (const snippet of requiredSnippets) {
        expect(file).toContain(snippet);
      }

      const orderedSnippets = [
        'Issue Intake',
        'Brainstorming',
        'Spec',
        'User Review Gate',
        'Plan',
        'Plan Review/Fix Loop',
        'Implementation',
        'Implementation Review/Fix Loop',
        'Verification'
      ];

      let lastIndex = -1;
      for (const snippet of orderedSnippets) {
        const index = file.indexOf(snippet);
        expect(index).toBeGreaterThan(lastIndex);
        lastIndex = index;
      }
    }
  });
});
