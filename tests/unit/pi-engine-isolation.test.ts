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

const PI_IMPORT_REGEX =
  /(?:from|import)\s*\(?\s*['"][^'"]*\/agents\/(?:pi(?:\/[^'"]*)?|pi-rpc(?:\/[^'"]*)?)['"]|PiAgentAdapter/;

describe('workflow engine pi isolation', () => {
  it('does not import PiAgentAdapter from src/agents/pi', async () => {
    const paths = await listTsFiles(workflowDir);
    const offenders: string[] = [];

    for (const filePath of paths) {
      const contents = await fs.readFile(filePath, 'utf8');
      if (PI_IMPORT_REGEX.test(contents)) {
        offenders.push(filePath);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reads at least one workflow file (sanity check)', async () => {
    const paths = await listTsFiles(workflowDir);
    expect(paths.length).toBeGreaterThan(0);
  });
});
