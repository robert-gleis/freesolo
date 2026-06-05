import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config/load.js';
import { DEFAULT_CONFIG } from '../../src/config/types.js';

const tempFiles: string[] = [];

afterEach(async () => {
  await Promise.all(tempFiles.map((file) => fs.unlink(file).catch(() => {})));
  tempFiles.length = 0;
});

async function writeTempConfig(content: string): Promise<string> {
  const file = path.join(os.tmpdir(), `issueflow-config-${Date.now()}.yaml`);
  await fs.writeFile(file, content);
  tempFiles.push(file);
  return file;
}

describe('loadConfig', () => {
  it('returns defaults when file is missing', async () => {
    const config = await loadConfig('/nonexistent/config.yaml');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('parses watcher interval and trigger label', async () => {
    const file = await writeTempConfig(`watcher:
  interval_seconds: 120
  trigger_label: "state:planned"
`);
    const config = await loadConfig(file);
    expect(config.watcher.interval_seconds).toBe(120);
    expect(config.watcher.trigger_label).toBe('state:planned');
  });

  it('throws on interval below minimum', async () => {
    const file = await writeTempConfig(`watcher:
  interval_seconds: 2
`);
    await expect(loadConfig(file)).rejects.toThrow(/interval_seconds/);
  });
});
