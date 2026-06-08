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

const INTEGRATION_IMPORT_REGEX =
  /(?:from|import)\s*\(?\s*['"][^'"]*\/integration(?:\/[^'"]*)?['"]/;

describe('workflow engine isolation from integration', () => {
  it('does not import from src/integration', async () => {
    const paths = await listTsFiles(workflowDir);
    const offenders: string[] = [];

    for (const filePath of paths) {
      const contents = await fs.readFile(filePath, 'utf8');
      if (INTEGRATION_IMPORT_REGEX.test(contents)) {
        offenders.push(filePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
