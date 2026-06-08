import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { isNumberedAdrFilename, listAdrs, nextAdrNumber, parseAdrFilename } from '../../src/memory/adrs.js';

async function writeAdrFixture(root: string, filename: string, body: string): Promise<void> {
  const adrDir = path.join(root, 'docs', 'adr');
  await fs.mkdir(adrDir, { recursive: true });
  await fs.writeFile(path.join(adrDir, filename), body);
}

describe('ADR filename helpers', () => {
  it('accepts four-digit numbered ADR filenames', () => {
    expect(isNumberedAdrFilename('0001-state-persistence-split.md')).toBe(true);
    expect(isNumberedAdrFilename('0042-foo-bar.md')).toBe(true);
  });

  it('rejects format docs and non-numbered files', () => {
    expect(isNumberedAdrFilename('ADR-FORMAT.md')).toBe(false);
    expect(isNumberedAdrFilename('CONTEXT-FORMAT.md')).toBe(false);
    expect(isNumberedAdrFilename('README.md')).toBe(false);
    expect(isNumberedAdrFilename('notes.md')).toBe(false);
    expect(isNumberedAdrFilename('001-legacy.md')).toBe(false);
  });

  it('parseAdrFilename returns number and slug', () => {
    expect(parseAdrFilename('0001-state-persistence-split.md')).toEqual({
      number: 1,
      slug: 'state-persistence-split'
    });
  });

  it('parseAdrFilename returns null for non-ADR names', () => {
    expect(parseAdrFilename('ADR-FORMAT.md')).toBeNull();
  });
});

describe('listAdrs', () => {
  it('returns numbered ADRs sorted ascending, excluding format docs', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-adrs-'));
    await writeAdrFixture(root, 'ADR-FORMAT.md', '# format');
    await writeAdrFixture(root, '0002-second.md', '# Second\n\ndecision.');
    await writeAdrFixture(root, '0001-first.md', '# First\n\ndecision.');

    const adrs = await listAdrs(root);

    expect(adrs.map((adr) => adr.number)).toEqual([1, 2]);
    expect(adrs[0]).toMatchObject({
      slug: 'first',
      filename: '0001-first.md',
      relativePath: 'docs/adr/0001-first.md',
      content: '# First\n\ndecision.'
    });
  });

  it('returns an empty array when docs/adr is missing', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-adrs-'));
    const adrs = await listAdrs(root);
    expect(adrs).toEqual([]);
  });
});

describe('nextAdrNumber', () => {
  it('returns max + 1', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-adrs-'));
    await writeAdrFixture(root, '0001-first.md', '# First');
    await writeAdrFixture(root, '0003-third.md', '# Third');

    expect(await nextAdrNumber(root)).toBe(4);
  });

  it('returns 1 when no numbered ADRs exist', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-adrs-'));
    await writeAdrFixture(root, 'ADR-FORMAT.md', '# format');

    expect(await nextAdrNumber(root)).toBe(1);
  });
});

describe('listAdrs edge cases', () => {
  it('ignores non-numbered markdown files like foo.md', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-adrs-'));
    await writeAdrFixture(root, 'foo.md', '# not an adr');
    await writeAdrFixture(root, '0001-first.md', '# First');

    const adrs = await listAdrs(root);
    expect(adrs).toHaveLength(1);
    expect(adrs[0].number).toBe(1);
  });

  it('sorts duplicate numbers stably by filename', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-adrs-'));
    await writeAdrFixture(root, '0001-z-last.md', '# Z');
    await writeAdrFixture(root, '0001-a-first.md', '# A');

    const adrs = await listAdrs(root);
    expect(adrs.map((adr) => adr.filename)).toEqual(['0001-a-first.md', '0001-z-last.md']);
  });
});

describe('listAdrs against repo layout', () => {
  it('finds numbered ADRs in this repository', async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const adrs = await listAdrs(repoRoot);

    expect(adrs.length).toBeGreaterThanOrEqual(2);
    expect(adrs.map((adr) => adr.number)).toEqual([...adrs.map((adr) => adr.number)].sort((a, b) => a - b));
    expect(adrs.some((adr) => adr.slug === 'state-persistence-split')).toBe(true);
  });
});
