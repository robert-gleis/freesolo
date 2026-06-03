import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const RUNTIME_TMUX_REGEX = /execa\(\s*['"]tmux['"]|runTmux\s*\(/;

const ALLOWLIST = new Set([
  'src/runners/tmux.ts',
  'src/runners/tmux-command.ts',
  'src/runners/index.ts'
]);

async function listTypeScriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTypeScriptFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('tmux runtime isolation under src/', () => {
  it('allows tmux runtime usage only in the runners allowlist', async () => {
    const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
    const files = await listTypeScriptFiles(srcRoot);

    for (const file of files) {
      const relative = path.relative(path.resolve(srcRoot, '..'), file).replaceAll('\\', '/');
      const content = await readFile(file, 'utf8');
      if (!RUNTIME_TMUX_REGEX.test(content)) {
        continue;
      }
      expect(ALLOWLIST.has(relative)).toBe(true);
    }
  });
});
