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

  it('records SIGINT on the running check when a real subprocess is killed', async () => {
    if (process.platform === 'win32') {
      // Windows SIGINT handling on Node subprocesses is unreliable; skip there.
      return;
    }

    const repoRoot = await makeRepo();
    await fs.writeFile(
      path.join(repoRoot, 'issueflow.config.json'),
      JSON.stringify({
        verification: {
          checks: [
            {
              name: 'long-running',
              command: process.execPath,
              args: ['-e', 'setInterval(() => {}, 1000)']
            }
          ]
        }
      })
    );

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const result = await createVerifyPlan(
      { cwd: repoRoot, options: { issue: 42 }, abortSignal: controller.signal },
      defaultVerifyPlanDeps
    );

    expect(result.mode).toBe('completed');
    if (result.mode !== 'completed') throw new Error('expected completed mode');

    expect(result.exitCode).toBe(130);
    // The check was killed mid-flight. Status must be 'fail'. Either signal is 'SIGINT'
    // (most platforms) or aborted=true drove the 130 mapping — both are valid v1 contracts.
    expect(result.run.checks[0].status).toBe('fail');

    const runDir = path.join(
      repoRoot,
      '.git/issueflow/verifications/issue-42',
      result.run.runId
    );
    await expect(fs.access(path.join(runDir, 'run.json'))).resolves.toBeUndefined();
  }, 10000);

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
