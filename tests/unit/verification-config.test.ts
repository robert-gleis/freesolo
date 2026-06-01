import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG_FILENAME, VerificationConfigError, loadVerificationConfig } from '../../src/verification/config.js';

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-verify-config-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('loadVerificationConfig', () => {
  it('loads and validates the default config file', async () => {
    const repoRoot = await makeRepo();
    await fs.writeFile(
      path.join(repoRoot, DEFAULT_CONFIG_FILENAME),
      JSON.stringify({
        verification: {
          checks: [{ name: 'lint', command: 'npm', args: ['run', 'lint'] }]
        }
      })
    );

    const config = await loadVerificationConfig(repoRoot);

    expect(config.verification.checks).toHaveLength(1);
    expect(config.verification.checks[0].name).toBe('lint');
  });

  it('accepts an explicit relative config path', async () => {
    const repoRoot = await makeRepo();
    const configPath = 'configs/checks.json';
    await fs.mkdir(path.join(repoRoot, 'configs'), { recursive: true });
    await fs.writeFile(
      path.join(repoRoot, configPath),
      JSON.stringify({ verification: { checks: [{ name: 'lint', command: 'eslint' }] } })
    );

    const config = await loadVerificationConfig(repoRoot, configPath);

    expect(config.verification.checks[0].command).toBe('eslint');
  });

  it('throws VerificationConfigError when the config is missing', async () => {
    const repoRoot = await makeRepo();

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/not found/);
  });

  it('throws VerificationConfigError when the JSON is invalid', async () => {
    const repoRoot = await makeRepo();
    await fs.writeFile(path.join(repoRoot, DEFAULT_CONFIG_FILENAME), '{ not json');

    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/not valid JSON/);
  });

  it('throws VerificationConfigError when the schema fails', async () => {
    const repoRoot = await makeRepo();
    await fs.writeFile(
      path.join(repoRoot, DEFAULT_CONFIG_FILENAME),
      JSON.stringify({ verification: { checks: [] } })
    );

    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/at least one check/i);
  });
});
