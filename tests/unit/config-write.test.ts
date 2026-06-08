import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initConfigFile, setConfigKey } from '../../src/config/write.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-write-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('initConfigFile', () => {
  it('creates a new file with commented template', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await initConfigFile(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('state_backend: github-labels');
    expect(content).toContain('autonomous_mode: false');
    expect(content).toContain('interval_seconds: 60');
    expect(content).toContain('trigger_label:');
  });

  it('creates parent directories if they do not exist', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'nested', 'dir', 'config.yaml');
    await initConfigFile(filePath);
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('throws when the file already exists', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'state_backend: local\n');
    await expect(initConfigFile(filePath)).rejects.toThrow(/already exists/);
  });
});

describe('setConfigKey — flat keys', () => {
  it('creates the file with the key when it does not exist', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await setConfigKey(filePath, 'state_backend', 'local');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('state_backend: local');
  });

  it('creates parent directories when the file does not exist', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'sub', 'config.yaml');
    await setConfigKey(filePath, 'autonomous_mode', 'true');
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('replaces an existing flat key in-place', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, '# comment\nstate_backend: github-labels\nautonomous_mode: false\n');
    await setConfigKey(filePath, 'state_backend', 'local');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('state_backend: local');
    expect(content).toContain('# comment');
    expect(content).toContain('autonomous_mode: false');
    expect(content).not.toContain('state_backend: github-labels');
  });

  it('appends a flat key that is absent from the file', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'autonomous_mode: false\n');
    await setConfigKey(filePath, 'state_backend', 'local');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('autonomous_mode: false');
    expect(content).toContain('state_backend: local');
  });
});

describe('setConfigKey — nested keys', () => {
  it('replaces an existing nested key within the watcher block', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'watcher:\n  interval_seconds: 60\n  trigger_label: "state:triaged"\n');
    await setConfigKey(filePath, 'watcher.interval_seconds', '120');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('interval_seconds: 120');
    expect(content).toContain('trigger_label:');
  });

  it('appends the full watcher block when watcher block is absent', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'state_backend: local\n');
    await setConfigKey(filePath, 'watcher.interval_seconds', '30');
    const content = await fs.readFile(filePath, 'utf8');
    expect(content).toContain('watcher:');
    expect(content).toContain('interval_seconds: 30');
  });

  it('injects a missing subkey into an existing watcher block', async () => {
    const dir = await makeTempDir();
    const filePath = path.join(dir, 'config.yaml');
    await fs.writeFile(filePath, 'watcher:\n  trigger_label: "state:triaged"\n');
    await setConfigKey(filePath, 'watcher.interval_seconds', '120');
    const content = await fs.readFile(filePath, 'utf8');
    // must not create a second watcher: block
    expect(content.match(/^watcher:/gm)?.length).toBe(1);
    expect(content).toContain('interval_seconds: 120');
    expect(content).toContain('trigger_label:');
  });
});
