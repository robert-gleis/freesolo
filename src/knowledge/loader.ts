import fs from 'node:fs/promises';
import path from 'node:path';

export interface KnowledgeEntry {
  filename: string;
  title: string;
  content: string;
}

const HEADING_RE = /^#\s+(.+)$/m;

/** Test export — title extraction helper, not part of the spec Public API surface. */
export function extractTitle(filename: string, content: string): string {
  const match = content.match(HEADING_RE);
  if (match?.[1]) {
    return match[1].trim();
  }

  return path.basename(filename, path.extname(filename));
}

export function formatKnowledgeSection(entries: KnowledgeEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const blocks = entries.map((entry) => `### ${entry.title}\n\n${entry.content.trim()}`);

  return [
    '## Factory Knowledge Base',
    '',
    'The following operational knowledge applies to this repository. It is loaded from `.freesolo/knowledge/*.md` at agent spawn time.',
    '',
    blocks.join('\n\n')
  ].join('\n');
}

export function appendKnowledgeToPrompt(basePrompt: string, entries: KnowledgeEntry[]): string {
  const section = formatKnowledgeSection(entries);
  if (!section) {
    return basePrompt;
  }

  return `${basePrompt}\n\n${section}`;
}

export async function loadKnowledgeEntries(repoRoot: string): Promise<KnowledgeEntry[]> {
  const knowledgeDir = path.join(repoRoot, '.freesolo', 'knowledge');

  let names: string[];
  try {
    names = await fs.readdir(knowledgeDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const markdownFiles = names.filter((name) => name.endsWith('.md')).sort();

  const entries: KnowledgeEntry[] = [];

  for (const filename of markdownFiles) {
    const absolutePath = path.join(knowledgeDir, filename);
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const content = await fs.readFile(absolutePath, 'utf8');
    entries.push({
      filename,
      title: extractTitle(filename, content),
      content
    });
  }

  return entries;
}
