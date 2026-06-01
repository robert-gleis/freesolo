import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { createVerifyPlan, defaultVerifyPlanDeps } from '../../src/commands/verify.js';

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-verify-int-'));
  tempDirs.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('issueflow verify (integration)', () => {
  it('runs configured checks and writes run.json plus per-check logs', async () => {
    const repoRoot = await makeRepo();
    const configPath = path.join(repoRoot, 'issueflow.config.json');

    await fs.writeFile(
      configPath,
      JSON.stringify({
        verification: {
          checks: [
            {
              name: 'pass-check',
              command: process.execPath,
              args: ['-e', 'process.stdout.write("ok\\n", () => process.exit(0))']
            },
            {
              name: 'fail-check',
              command: process.execPath,
              args: ['-e', 'process.stdout.write("failure\\n", () => process.exit(3))']
            }
          ]
        }
      })
    );

    const result = await createVerifyPlan(
      { cwd: repoRoot, options: { issue: 99 } },
      defaultVerifyPlanDeps
    );

    expect(result.mode).toBe('completed');
    if (result.mode !== 'completed') {
      throw new Error('expected completed mode');
    }

    expect(result.run.status).toBe('fail');
    expect(result.exitCode).toBe(1);
    expect(result.run.checks.map((check) => check.status)).toEqual(['pass', 'fail']);
    expect(result.run.checks[1].exitCode).toBe(3);

    const runDir = path.join(repoRoot, '.git/issueflow/verifications/issue-99', result.run.runId);
    const runJson = JSON.parse(await fs.readFile(path.join(runDir, 'run.json'), 'utf8'));
    expect(runJson.runId).toBe(result.run.runId);

    const passLog = await fs.readFile(path.join(runDir, 'pass-check.log'), 'utf8');
    expect(passLog).toContain('[stdout] ok');

    const failLog = await fs.readFile(path.join(runDir, 'fail-check.log'), 'utf8');
    expect(failLog).toContain('[stdout] failure');
  });

  it('print-only does not spawn checks or create run.json', async () => {
    const repoRoot = await makeRepo();
    const configPath = path.join(repoRoot, 'issueflow.config.json');

    await fs.writeFile(
      configPath,
      JSON.stringify({
        verification: {
          checks: [{ name: 'pass-check', command: process.execPath, args: ['-e', 'console.log("ok")'] }]
        }
      })
    );

    const result = await createVerifyPlan(
      { cwd: repoRoot, options: { issue: 7, printOnly: true } },
      defaultVerifyPlanDeps
    );

    expect(result.mode).toBe('print-only');
    if (result.mode !== 'print-only') {
      throw new Error('expected print-only mode');
    }

    expect(result.summaryLines.join('\n')).toContain('pass-check');

    const issueDir = path.join(repoRoot, '.git/issueflow/verifications/issue-7');
    await expect(fs.access(issueDir)).rejects.toThrow();
  });

  it('reports a hard error when the config is missing', async () => {
    const repoRoot = await makeRepo();

    const result = await createVerifyPlan(
      { cwd: repoRoot, options: { issue: 1 } },
      defaultVerifyPlanDeps
    );

    expect(result.mode).toBe('error');
    if (result.mode !== 'error') {
      throw new Error('expected error mode');
    }

    expect(result.exitCode).toBe(2);
    expect(result.message).toMatch(/not found/);
  });
});
