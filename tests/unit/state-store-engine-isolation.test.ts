import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

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

// Matches imports from the new `state-store/` directory (e.g.
// `from '../state-store/types.js'` or `from '../state-store'`). Deliberately
// does NOT match the existing `src/workflow/state-store.ts` file because the
// regex requires `/` or end-of-quote immediately after `state-store`, while
// the workflow file is imported as `from './state-store.js'` (a `.` follows).
const STATE_STORE_IMPORT_REGEX = /(?:from|import)\s*\(?\s*['"][^'"]*\/state-store(?:\/[^'"]*)?['"]/;
const SQLITE_REGEX = /better-sqlite3/i;

describe('workflow engine isolation from state store', () => {
  it('does not import from src/state-store', async () => {
    const files = await readWorkflowFiles();

    const offenders = files
      .filter((file) => STATE_STORE_IMPORT_REGEX.test(file.contents))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('does not import better-sqlite3 directly', async () => {
    const files = await readWorkflowFiles();

    const offenders = files
      .filter((file) => SQLITE_REGEX.test(file.contents))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('reads at least one workflow file (sanity check)', async () => {
    const files = await readWorkflowFiles();
    expect(files.length).toBeGreaterThan(0);
  });
});
