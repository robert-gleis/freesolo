import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

describe('ensure-bin-executable', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('marks generated CLI files as executable', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'issueflow-bin-'));
    tempDirs.push(tempDir);

    const binPath = join(tempDir, 'bin.js');
    await writeFile(binPath, '#!/usr/bin/env node\nconsole.log("issueflow");\n');
    await chmod(binPath, 0o644);

    await execa(process.execPath, ['scripts/ensure-bin-executable.mjs', binPath], {
      cwd: process.cwd()
    });

    expect((await stat(binPath)).mode & 0o777).toBe(0o755);
  });
});
