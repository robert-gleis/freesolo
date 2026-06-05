import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

const workflowDir = path.resolve(process.cwd(), 'src/workflow');

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

interface WorkflowFile {
  path: string;
  contents: string;
}

async function readWorkflowFiles(): Promise<WorkflowFile[]> {
  const paths = await listTsFiles(workflowDir);
  return Promise.all(
    paths.map(async (filePath) => ({
      path: filePath,
      contents: await fs.readFile(filePath, 'utf8')
    }))
  );
}

// Matches both static `from '...'` and dynamic `import('...')` against any path
// that ends in `/worktrees` or `/worktrees/<anything>`. The required `/` before
// `worktrees` restricts this to *relative* import paths (e.g. `'../worktrees/x'`,
// `'./worktrees'`); the repo never uses bare-specifier imports, so this is fine
// in practice and matches the precedent set by `runner-engine-isolation.test.ts`.
const WORKTREES_IMPORT_REGEX = /(?:from|import)\s*\(?\s*['"][^'"]*\/worktrees(?:\/[^'"]*)?['"]/;

describe('workflow engine isolation from worktrees module', () => {
  it('does not import from src/worktrees', async () => {
    const files = await readWorkflowFiles();

    const offenders = files
      .filter((file) => WORKTREES_IMPORT_REGEX.test(file.contents))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('reads at least one file (sanity check)', async () => {
    const files = await readWorkflowFiles();
    expect(files.length).toBeGreaterThan(0);
  });
});
