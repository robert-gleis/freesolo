import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  appendKnowledgeToPrompt,
  extractTitle,
  formatKnowledgeSection,
  loadKnowledgeEntries,
  type KnowledgeEntry
} from '../../src/knowledge/loader.js';

const tempDirs: string[] = [];

async function makeTempRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-knowledge-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('extractTitle', () => {
  it('uses the first markdown heading when present', () => {
    expect(extractTitle('build.md', '# Build Commands\n\nRun npm run build.')).toBe('Build Commands');
  });

  it('falls back to the filename stem when no heading exists', () => {
    expect(extractTitle('test.md', 'Run npm test.')).toBe('test');
  });
});

describe('formatKnowledgeSection', () => {
  it('returns an empty string for no entries', () => {
    expect(formatKnowledgeSection([])).toBe('');
  });

  it('formats entries with headings and file contents', () => {
    const entries: KnowledgeEntry[] = [
      {
        filename: 'build.md',
        title: 'Build',
        content: '# Build\n\nnpm run build'
      }
    ];

    const section = formatKnowledgeSection(entries);

    expect(section).toContain('## Factory Knowledge Base');
    expect(section).toContain('loaded from `.issueflow/knowledge/*.md`');
    expect(section).toContain('### Build');
    expect(section).toContain('npm run build');
  });

  it('separates multiple entry blocks with a blank line', () => {
    const entries: KnowledgeEntry[] = [
      { filename: 'build.md', title: 'Build', content: '# Build\n\nnpm run build' },
      { filename: 'test.md', title: 'Test', content: '# Test\n\nnpm test' }
    ];

    const section = formatKnowledgeSection(entries);

    expect(section).toContain('npm run build\n\n### Test');
  });
});

describe('appendKnowledgeToPrompt', () => {
  it('returns the base prompt unchanged when entries are empty', () => {
    expect(appendKnowledgeToPrompt('kernel text', [])).toBe('kernel text');
  });

  it('appends the knowledge section separated by a blank line', () => {
    const entries: KnowledgeEntry[] = [
      { filename: 'test.md', title: 'Test', content: 'npm test' }
    ];

    const result = appendKnowledgeToPrompt('kernel text', entries);

    expect(result).toBe(`kernel text\n\n${formatKnowledgeSection(entries)}`);
  });
});

describe('loadKnowledgeEntries', () => {
  it('returns an empty array when the knowledge directory is missing', async () => {
    const repoRoot = await makeTempRepo();
    await expect(loadKnowledgeEntries(repoRoot)).resolves.toEqual([]);
  });

  it('returns an empty array when the knowledge directory exists but is empty', async () => {
    const repoRoot = await makeTempRepo();
    await fs.mkdir(path.join(repoRoot, '.issueflow', 'knowledge'), { recursive: true });
    await expect(loadKnowledgeEntries(repoRoot)).resolves.toEqual([]);
  });

  it('loads markdown files in alphabetical order', async () => {
    const repoRoot = await makeTempRepo();
    const knowledgeDir = path.join(repoRoot, '.issueflow', 'knowledge');
    await fs.mkdir(knowledgeDir, { recursive: true });
    await fs.writeFile(path.join(knowledgeDir, 'z-last.md'), '# Z Last\n\nz');
    await fs.writeFile(path.join(knowledgeDir, 'a-first.md'), '# A First\n\na');

    const entries = await loadKnowledgeEntries(repoRoot);

    expect(entries.map((entry) => entry.filename)).toEqual(['a-first.md', 'z-last.md']);
    expect(entries[0]?.title).toBe('A First');
  });

  it('ignores non-markdown files and subdirectories', async () => {
    const repoRoot = await makeTempRepo();
    const knowledgeDir = path.join(repoRoot, '.issueflow', 'knowledge');
    await fs.mkdir(path.join(knowledgeDir, 'nested'), { recursive: true });
    await fs.writeFile(path.join(knowledgeDir, 'notes.txt'), 'ignore');
    await fs.writeFile(path.join(knowledgeDir, 'valid.md'), 'content');

    const entries = await loadKnowledgeEntries(repoRoot);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.filename).toBe('valid.md');
  });

  it('loads the shipped starter knowledge files from the repository', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../..');
    const entries = await loadKnowledgeEntries(repoRoot);

    expect(entries.map((entry) => entry.filename)).toEqual([
      'build.md',
      'conventions.md',
      'deploy.md',
      'test.md'
    ]);
    expect(formatKnowledgeSection(entries)).toContain('## Factory Knowledge Base');
    expect(formatKnowledgeSection(entries)).toContain('npm run build');
  });
});
