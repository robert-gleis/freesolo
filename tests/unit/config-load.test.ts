import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig, loadConfigWithOrigins, repoConfigPath } from '../../src/config/load.js';
import { DEFAULT_CONFIG } from '../../src/config/types.js';

const tempFiles: string[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempFiles.map((file) => fs.unlink(file).catch(() => {})));
  tempFiles.length = 0;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeTempConfig(content: string): Promise<string> {
  const file = path.join(os.tmpdir(), `freesolo-config-${Date.now()}.yaml`);
  await fs.writeFile(file, content);
  tempFiles.push(file);
  return file;
}

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('loadConfig', () => {
  it('returns defaults when file is missing', async () => {
    const config = await loadConfig('/nonexistent/config.yaml');
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('defaults watcher intake to assigned-to-me confirm', async () => {
    const config = await loadConfig('/nonexistent/config.yaml');
    expect(config.watcher).toEqual({
      interval_seconds: 60,
      source: 'assigned-to-me',
      intake_mode: 'confirm',
      initial_state: 'triaged',
      trigger_label: 'triaged'
    });
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

  it('parses all watcher intake keys', async () => {
    const file = await writeTempConfig(`watcher:
  interval_seconds: 120
  source: label
  intake_mode: auto
  initial_state: planned
  trigger_label: "ready"
`);
    const config = await loadConfig(file);
    expect(config.watcher).toEqual({
      interval_seconds: 120,
      source: 'label',
      intake_mode: 'auto',
      initial_state: 'planned',
      trigger_label: 'ready'
    });
  });

  it('throws on interval below minimum', async () => {
    const file = await writeTempConfig(`watcher:
  interval_seconds: 2
`);
    await expect(loadConfig(file)).rejects.toThrow(/interval_seconds/);
  });

  it('throws on invalid watcher source', async () => {
    const file = await writeTempConfig(`watcher:
  source: mine
`);
    await expect(loadConfig(file)).rejects.toThrow(/watcher.source/);
  });

  it('throws on invalid watcher intake mode', async () => {
    const file = await writeTempConfig(`watcher:
  intake_mode: maybe
`);
    await expect(loadConfig(file)).rejects.toThrow(/watcher.intake_mode/);
  });

  it('throws when watcher initial state is closed', async () => {
    const file = await writeTempConfig(`watcher:
  initial_state: closed
`);
    await expect(loadConfig(file)).rejects.toThrow(/watcher.initial_state/);
  });

  it('defaults autonomous_mode to false', async () => {
    const config = await loadConfig('/nonexistent/config.yaml');
    expect(config.autonomous_mode).toBe(false);
  });

  it('parses autonomous_mode from global config', async () => {
    const file = await writeTempConfig(`autonomous_mode: true
watcher:
  interval_seconds: 60
  trigger_label: "state:triaged"
`);
    const config = await loadConfig(file);
    expect(config.autonomous_mode).toBe(true);
  });

  it('throws on invalid autonomous_mode value', async () => {
    const file = await writeTempConfig(`autonomous_mode: maybe
`);
    await expect(loadConfig(file)).rejects.toThrow(/autonomous_mode/);
  });

});

describe('repoConfigPath', () => {
  it('returns .freesolo/config.yaml inside the given root', () => {
    expect(repoConfigPath('/my/repo')).toBe('/my/repo/.freesolo/config.yaml');
  });
});

describe('loadConfig with repoRoot', () => {
  it('returns defaults when neither global nor repo config exists', async () => {
    const dir = await makeTempDir();
    const config = await loadConfig(path.join(dir, 'global.yaml'), dir);
    expect(config.autonomous_mode).toBe(false);
    expect(config.watcher.interval_seconds).toBe(60);
    expect(config.watcher.trigger_label).toBe('triaged');
  });

  it('repo config overrides global config per-field', async () => {
    const dir = await makeTempDir();
    const globalPath = path.join(dir, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\nwatcher:\n  interval_seconds: 90\n');
    const repoDir = await makeTempDir();
    await fs.mkdir(path.join(repoDir, '.freesolo'), { recursive: true });
    await fs.writeFile(path.join(repoDir, '.freesolo', 'config.yaml'), 'watcher:\n  interval_seconds: 120\n');
    const config = await loadConfig(globalPath, repoDir);
    expect(config.watcher.interval_seconds).toBe(120); // repo wins
    expect(config.autonomous_mode).toBe(true);         // falls back to global
  });

  it('global config applies when no repo config exists', async () => {
    const dir = await makeTempDir();
    const globalPath = path.join(dir, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\n');
    const repoDir = await makeTempDir();
    const config = await loadConfig(globalPath, repoDir);
    expect(config.autonomous_mode).toBe(true);
  });
});

describe('loadConfigWithOrigins', () => {
  it('marks all keys as default when no config files exist', async () => {
    const dir = await makeTempDir();
    const { origins } = await loadConfigWithOrigins(path.join(dir, 'global.yaml'), dir);
    expect(origins.autonomous_mode).toBe('default');
    expect(origins['watcher.interval_seconds']).toBe('default');
    expect(origins['watcher.source']).toBe('default');
    expect(origins['watcher.intake_mode']).toBe('default');
    expect(origins['watcher.initial_state']).toBe('default');
    expect(origins['watcher.trigger_label']).toBe('default');
  });

  it('marks a key as global when set only in global config', async () => {
    const dir = await makeTempDir();
    const globalPath = path.join(dir, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\n');
    const { origins } = await loadConfigWithOrigins(globalPath, dir);
    expect(origins.autonomous_mode).toBe('global');
    expect(origins['watcher.interval_seconds']).toBe('default');
  });

  it('marks a key as repo when set in repo config', async () => {
    const dir = await makeTempDir();
    const repoDir = await makeTempDir();
    await fs.mkdir(path.join(repoDir, '.freesolo'), { recursive: true });
    await fs.writeFile(path.join(repoDir, '.freesolo', 'config.yaml'), 'autonomous_mode: true\n');
    const { origins } = await loadConfigWithOrigins(path.join(dir, 'global.yaml'), repoDir);
    expect(origins.autonomous_mode).toBe('repo');
    expect(origins['watcher.interval_seconds']).toBe('default');
  });
});
