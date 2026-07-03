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

function validGateRoute() {
  return {
    verification: {
      gateRoute: {
        maxAttempts: 3,
        bail: true,
        checks: [
          { name: 'build', kind: 'shell', command: 'npm', args: ['run', 'build'] },
          {
            name: 'review',
            kind: 'agent-review',
            host: 'codex',
            promptPreset: 'thermonuclear-review'
          }
        ],
        fixer: { host: 'codex', promptPreset: 'gate-fixer' }
      }
    }
  };
}

async function writeConfig(repoRoot: string, config: unknown): Promise<void> {
  await fs.writeFile(path.join(repoRoot, DEFAULT_CONFIG_FILENAME), JSON.stringify(config));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('loadVerificationConfig', () => {
  it('loads and validates a gateRoute config', async () => {
    const repoRoot = await makeRepo();
    await writeConfig(repoRoot, validGateRoute());

    const config = await loadVerificationConfig(repoRoot);

    expect(config.verification.gateRoute.checks).toHaveLength(2);
    expect(config.verification.gateRoute.maxAttempts).toBe(3);
  });

  it('accepts an explicit relative config path', async () => {
    const repoRoot = await makeRepo();
    const configPath = 'configs/gate.json';
    await fs.mkdir(path.join(repoRoot, 'configs'), { recursive: true });
    await fs.writeFile(path.join(repoRoot, configPath), JSON.stringify(validGateRoute()));

    const config = await loadVerificationConfig(repoRoot, configPath);

    expect(config.verification.gateRoute.fixer.host).toBe('codex');
  });

  it('throws VerificationConfigError when the config is missing', async () => {
    const repoRoot = await makeRepo();

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/not found/);
  });

  it('throws VerificationConfigError when the JSON is invalid', async () => {
    const repoRoot = await makeRepo();
    await fs.writeFile(path.join(repoRoot, DEFAULT_CONFIG_FILENAME), '{ not json');

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/not valid JSON/);
  });

  it('throws VerificationConfigError for the old verification.checks shape', async () => {
    const repoRoot = await makeRepo();
    await writeConfig(repoRoot, {
      verification: { checks: [{ name: 'lint', command: 'npm', args: ['run', 'lint'] }] }
    });

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/invalid/);
  });

  it('throws VerificationConfigError when gateRoute is missing', async () => {
    const repoRoot = await makeRepo();
    await writeConfig(repoRoot, { verification: {} });

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
  });

  it('throws VerificationConfigError when the schema fails', async () => {
    const repoRoot = await makeRepo();
    const config = validGateRoute();
    config.verification.gateRoute.checks = [];
    await writeConfig(repoRoot, config);

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
  });

  it('rejects an agent-review check with an unknown promptPreset', async () => {
    const repoRoot = await makeRepo();
    const config = validGateRoute();
    config.verification.gateRoute.checks[1].promptPreset = 'no-such-preset';
    await writeConfig(repoRoot, config);

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/no-such-preset/);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/unknown prompt preset/i);
  });

  it('rejects a fixer with an unknown promptPreset', async () => {
    const repoRoot = await makeRepo();
    const config = validGateRoute();
    config.verification.gateRoute.fixer.promptPreset = 'no-such-fixer';
    await writeConfig(repoRoot, config);

    await expect(loadVerificationConfig(repoRoot)).rejects.toBeInstanceOf(VerificationConfigError);
    await expect(loadVerificationConfig(repoRoot)).rejects.toThrow(/no-such-fixer/);
  });

  it('accepts a config whose checks and fixer use known presets', async () => {
    const repoRoot = await makeRepo();
    await writeConfig(repoRoot, validGateRoute());

    const config = await loadVerificationConfig(repoRoot);

    expect(config.verification.gateRoute.fixer.promptPreset).toBe('gate-fixer');
    const review = config.verification.gateRoute.checks.find((c) => c.kind === 'agent-review');
    expect(review?.promptPreset).toBe('thermonuclear-review');
  });
});
