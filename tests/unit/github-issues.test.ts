import { describe, expect, it, vi } from 'vitest';

import {
  ChildIssueCreationError,
  createChildIssues,
  ensureParentSection,
  type GhRunner
} from '../../src/github/issues.js';

describe('ensureParentSection', () => {
  it('prepends parent section when missing', () => {
    expect(ensureParentSection('Do the work', 37)).toBe('## Parent\n\n#37\n\nDo the work');
  });

  it('keeps body when parent matches', () => {
    const body = '## Parent\n\n#37\n\nWork';
    expect(ensureParentSection(body, 37)).toBe(body);
  });

  it('rejects wrong parent reference', () => {
    expect(() => ensureParentSection('## Parent\n\n#99\n\nWork', 37)).toThrow(
      ChildIssueCreationError
    );
  });
});

describe('createChildIssues', () => {
  it('creates issues sequentially with labels and prepends parent section', async () => {
    const calls: string[][] = [];
    const runGh: GhRunner = vi.fn(async (_command, args) => {
      calls.push(args);
      return {
        stdout: JSON.stringify({
          number: 100 + calls.length,
          title: args[args.indexOf('--title') + 1],
          url: `https://github.com/acme/widgets/issues/${100 + calls.length}`
        })
      };
    });

    const created = await createChildIssues({
      repo: { owner: 'acme', repo: 'widgets' },
      parentIssue: 37,
      children: [
        { title: 'A', body: 'work', labels: ['state:triaged'] },
        { title: 'B', body: '## Parent\n\n#37\n\nmore', labels: [] }
      ],
      runGh
    });

    expect(created).toHaveLength(2);
    expect(calls[0]).toContain('--label');
    expect(calls[0]).toContain('state:triaged');
    const bodyArg = calls[0][calls[0].indexOf('--body') + 1];
    expect(bodyArg).toContain('## Parent');
    expect(bodyArg).toContain('#37');
  });

  it('throws ChildIssueCreationError with child index on gh failure', async () => {
    const runGh: GhRunner = vi.fn(async () => {
      throw new Error('gh: validation failed');
    });
    await expect(
      createChildIssues({
        repo: { owner: 'acme', repo: 'widgets' },
        parentIssue: 37,
        children: [{ title: 'A', body: 'work', labels: [] }],
        runGh
      })
    ).rejects.toMatchObject({ childIndex: 0 });
  });
});
