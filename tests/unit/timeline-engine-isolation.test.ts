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

const FORBIDDEN_IMPORT_REGEX =
  /(?:from|import)\s*\(?\s*['"][^'"]*\/(?:event-log|timeline)(?:\/[^'"]*)?['"]/;

describe('workflow engine isolation from timeline module', () => {
  it('does not import from src/event-log or src/timeline', async () => {
    const files = await listTsFiles(workflowDir);
    const offenders = [];

    for (const filePath of files) {
      const contents = await fs.readFile(filePath, 'utf8');
      if (FORBIDDEN_IMPORT_REGEX.test(contents)) {
        offenders.push(filePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
