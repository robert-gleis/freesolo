import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveAutonomousMode } from '../../src/policy/config.js';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freesolo-policy-config-'));
  dirs.push(dir);
  return dir;
}

describe('resolveAutonomousMode', () => {
  it('returns false when no config files exist', async () => {
    const repoRoot = await makeRepo();
    const mode = await resolveAutonomousMode(repoRoot, {
      globalConfigPath: path.join(repoRoot, 'missing-global.yaml'),
      readFile: fs.readFile
    });
    expect(mode).toBe(false);
  });

  it('reads autonomous_mode from global config', async () => {
    const repoRoot = await makeRepo();
    const globalPath = path.join(repoRoot, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\n');
    const mode = await resolveAutonomousMode(repoRoot, {
      globalConfigPath: globalPath,
      readFile: fs.readFile
    });
    expect(mode).toBe(true);
  });

  it('repo .freesolo/config.yaml overrides global', async () => {
    const repoRoot = await makeRepo();
    const globalPath = path.join(repoRoot, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\n');
    const repoConfigDir = path.join(repoRoot, '.freesolo');
    await fs.mkdir(repoConfigDir, { recursive: true });
    await fs.writeFile(path.join(repoConfigDir, 'config.yaml'), 'autonomous_mode: false\n');
    const mode = await resolveAutonomousMode(repoRoot, {
      globalConfigPath: globalPath,
      readFile: fs.readFile
    });
    expect(mode).toBe(false);
  });

  it('falls back to global when repo config exists but omits autonomous_mode', async () => {
    const repoRoot = await makeRepo();
    const globalPath = path.join(repoRoot, 'global.yaml');
    await fs.writeFile(globalPath, 'autonomous_mode: true\n');
    const repoConfigDir = path.join(repoRoot, '.freesolo');
    await fs.mkdir(repoConfigDir, { recursive: true });
    await fs.writeFile(path.join(repoConfigDir, 'config.yaml'), 'watcher:\n  interval_seconds: 60\n');
    const mode = await resolveAutonomousMode(repoRoot, {
      globalConfigPath: globalPath,
      readFile: fs.readFile
    });
    expect(mode).toBe(true);
  });

  it('throws on invalid repo config value', async () => {
    const repoRoot = await makeRepo();
    const repoConfigDir = path.join(repoRoot, '.freesolo');
    await fs.mkdir(repoConfigDir, { recursive: true });
    await fs.writeFile(path.join(repoConfigDir, 'config.yaml'), 'autonomous_mode: yes\n');
    await expect(
      resolveAutonomousMode(repoRoot, {
        globalConfigPath: path.join(repoRoot, 'missing-global.yaml'),
        readFile: fs.readFile
      })
    ).rejects.toThrow(/autonomous_mode/);
  });
});
