import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { findIssueArtifacts } from '../../src/core/artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('findIssueArtifacts', () => {
  it('discovers existing spec, plan, and review artifacts for the selected issue', async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-artifacts-'));
    tempDirs.push(repoRoot);

    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/specs'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/plans'), { recursive: true });
    await fs.mkdir(path.join(repoRoot, 'docs/issueflow/reviews'), { recursive: true });

    const specPath = path.join(repoRoot, 'docs/issueflow/specs/2026-04-20-issue-12-design.md');
    const planPath = path.join(repoRoot, 'docs/issueflow/plans/2026-04-21-issue-12-plan.md');
    const implementationReviewPath = path.join(repoRoot, 'docs/issueflow/reviews/2026-04-22-issue-12-implementation-review.md');

    await fs.writeFile(specPath, '# spec');
    await fs.writeFile(planPath, '# plan');
    await fs.writeFile(implementationReviewPath, '# review');
    await fs.writeFile(path.join(repoRoot, 'docs/issueflow/specs/2026-04-20-issue-99-design.md'), '# other');

    const artifacts = await findIssueArtifacts(repoRoot, 12);

    expect(artifacts).toEqual({
      spec: specPath,
      plan: planPath,
      planReview: null,
      implementationReview: implementationReviewPath
    });
  });
});
