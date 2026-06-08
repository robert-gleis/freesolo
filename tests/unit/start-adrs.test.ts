import { describe, expect, it, vi } from 'vitest';

import { createStartPlan, type StartPlanDeps } from '../../src/commands/start.js';
import type { IssueSummary } from '../../src/core/types.js';

const issue: IssueSummary = {
  number: 21,
  title: 'Architecture Decision Records (ADRs)',
  body: 'Adopt ADRs.',
  url: 'https://github.com/robert-gleis/issueflow/issues/21',
  labels: ['enhancement'],
  assignees: ['robert-gleis'],
  slug: 'architecture-decision-records-adrs',
  status: null
};

function baseDeps(overrides: Partial<StartPlanDeps> = {}): StartPlanDeps {
  return {
    resolveRepoRoot: async () => '/repo',
    readOriginRemote: async () => 'git@github.com:robert-gleis/issueflow.git',
    ensureWorktrunkAvailable: async () => {},
    listAssignedIssues: async () => [issue],
    listLocalBranches: async () => [],
    listWorktreeEntries: async () => [],
    switchNewIssueWorktree: async () => {},
    switchExistingIssueWorktree: async () => {},
    resolveBranchWorktreePath: async () => '/tmp/issue-21',
    findIssueArtifacts: async () => ({
      spec: null,
      plan: null,
      planReview: null,
      implementationReview: null
    }),
    listAdrs: async () => [
      {
        number: 1,
        slug: 'state-persistence-split',
        filename: '0001-state-persistence-split.md',
        relativePath: 'docs/adr/0001-state-persistence-split.md',
        content: '# State persistence'
      }
    ],
    writeSessionState: async () => {},
    writeIssuePacket: vi.fn(async () => {}),
    chooseIssue: async () => issue,
    confirmReuse: async () => true,
    getHostAssetSpec: () => ({
      tool: 'cursor',
      label: 'Cursor skill',
      source: '/src',
      target: '/dst',
      installCommand: ['cp', '/src', '/dst']
    }),
    checkHostAsset: async () => 'current' as const,
    installHostAsset: async () => {},
    confirmHostAssetInstall: async () => true,
    upsertWorktreeMetadata: async () => {},
    now: () => new Date('2026-06-05T00:00:00.000Z'),
    loadKnowledgeEntries: async () => [],
    ...overrides
  };
}

describe('createStartPlan ADR injection', () => {
  it('passes loaded ADRs into writeIssuePacket', async () => {
    const writeIssuePacket = vi.fn(async () => {});
    const listAdrs = vi.fn(async () => [
      {
        number: 1,
        slug: 'state-persistence-split',
        filename: '0001-state-persistence-split.md',
        relativePath: 'docs/adr/0001-state-persistence-split.md',
        content: '# State persistence'
      }
    ]);

    await createStartPlan(
      { cwd: '/repo', tool: 'cursor', printOnly: false },
      baseDeps({ writeIssuePacket, listAdrs })
    );

    expect(listAdrs).toHaveBeenCalledWith('/tmp/issue-21');
    expect(writeIssuePacket).toHaveBeenCalledOnce();
    const markdown = writeIssuePacket.mock.calls[0][1] as string;
    expect(markdown).toContain('## Architecture Decision Records');
    expect(markdown).toContain('ADR-0001');
  });
});
