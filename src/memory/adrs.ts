import fs from 'node:fs/promises';
import path from 'node:path';

const NUMBERED_ADR_PATTERN = /^(\d{4})-(.+)\.md$/;
const ADR_DIR = ['docs', 'adr'] as const;
const EXCLUDED_FILENAMES = new Set(['ADR-FORMAT.md', 'CONTEXT-FORMAT.md', 'README.md']);

export interface AdrRecord {
  number: number;
  slug: string;
  filename: string;
  relativePath: string;
  content: string;
}

export function isNumberedAdrFilename(filename: string): boolean {
  return NUMBERED_ADR_PATTERN.test(filename);
}

export function parseAdrFilename(filename: string): { number: number; slug: string } | null {
  const match = filename.match(NUMBERED_ADR_PATTERN);

  if (!match) {
    return null;
  }

  return {
    number: Number.parseInt(match[1], 10),
    slug: match[2]
  };
}

async function readAdrDirectory(repoRoot: string): Promise<string[] | null> {
  const absoluteDir = path.join(repoRoot, ...ADR_DIR);

  try {
    return await fs.readdir(absoluteDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function listAdrs(repoRoot: string): Promise<AdrRecord[]> {
  const entries = await readAdrDirectory(repoRoot);

  if (!entries) {
    return [];
  }

  const numbered = entries
    .filter((filename) => !EXCLUDED_FILENAMES.has(filename))
    .filter(isNumberedAdrFilename)
    .map((filename) => {
      const parsed = parseAdrFilename(filename)!;
      return { filename, ...parsed };
    })
    .sort((left, right) => left.number - right.number || left.filename.localeCompare(right.filename));

  const adrs: AdrRecord[] = [];

  for (const entry of numbered) {
    const absolutePath = path.join(repoRoot, ...ADR_DIR, entry.filename);
    const content = await fs.readFile(absolutePath, 'utf8');

    adrs.push({
      number: entry.number,
      slug: entry.slug,
      filename: entry.filename,
      relativePath: path.posix.join(...ADR_DIR, entry.filename),
      content
    });
  }

  return adrs;
}

export async function nextAdrNumber(repoRoot: string): Promise<number> {
  const adrs = await listAdrs(repoRoot);

  if (adrs.length === 0) {
    return 1;
  }

  return Math.max(...adrs.map((adr) => adr.number)) + 1;
}
