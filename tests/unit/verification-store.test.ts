import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import {
  getIssueVerificationsDir,
  getRunDirectory,
  listRuns,
  loadLatestRun,
  writeRun
} from '../../src/verification/store.js';
import type { VerificationRun } from '../../src/verification/types.js';

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-verify-store-'));
  tempDirs.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

function makeRun(repoRoot: string, runId: string, status: 'pass' | 'fail' = 'pass'): VerificationRun {
  return {
    schemaVersion: 1 as const,
    runId,
    issueNumber: 42,
    repoRoot,
    configPath: path.join(repoRoot, 'issueflow.config.json'),
    startedAt: `${runId}-start`,
    finishedAt: `${runId}-end`,
    status,
    bail: false,
    checks: [
      {
        name: 'lint',
        command: 'eslint',
        args: ['.'],
        cwd: repoRoot,
        status: status === 'pass' ? 'pass' : 'fail',
        exitCode: status === 'pass' ? 0 : 1,
        signal: null,
        startedAt: `${runId}-start`,
        finishedAt: `${runId}-end`,
        durationMs: 5,
        logPath: path.join(repoRoot, '.git/issueflow/verifications/issue-42', runId, 'lint.log')
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('verification store', () => {
  it('resolves the issue verifications directory under .git/issueflow', async () => {
    const repoRoot = await makeRepo();

    const dir = await getIssueVerificationsDir(repoRoot, 42);

    expect(dir).toBe(path.join(repoRoot, '.git/issueflow/verifications/issue-42'));
  });

  it('writes run.json under the resolved run directory', async () => {
    const repoRoot = await makeRepo();
    const run = makeRun(repoRoot, '2026-06-01T10-00-00-000Z');

    await writeRun(run);

    const runDir = await getRunDirectory(repoRoot, 42, run.runId);
    const written = JSON.parse(await fs.readFile(path.join(runDir, 'run.json'), 'utf8')) as VerificationRun;
    expect(written.runId).toBe(run.runId);
    expect(written.checks[0].name).toBe('lint');
  });

  it('lists runs sorted by runId descending', async () => {
    const repoRoot = await makeRepo();

    await writeRun(makeRun(repoRoot, '2026-06-01T10-00-00-000Z'));
    await writeRun(makeRun(repoRoot, '2026-06-02T10-00-00-000Z', 'fail'));
    await writeRun(makeRun(repoRoot, '2026-05-30T10-00-00-000Z'));

    const runs = await listRuns(repoRoot, 42);

    expect(runs.map((run) => run.runId)).toEqual([
      '2026-06-02T10-00-00-000Z',
      '2026-06-01T10-00-00-000Z',
      '2026-05-30T10-00-00-000Z'
    ]);
  });

  it('returns null when no runs exist for the issue', async () => {
    const repoRoot = await makeRepo();

    expect(await loadLatestRun(repoRoot, 42)).toBeNull();
  });

  it('returns the latest run when runs exist', async () => {
    const repoRoot = await makeRepo();

    await writeRun(makeRun(repoRoot, '2026-06-01T10-00-00-000Z'));
    await writeRun(makeRun(repoRoot, '2026-06-02T10-00-00-000Z', 'fail'));

    const latest = await loadLatestRun(repoRoot, 42);

    expect(latest?.runId).toBe('2026-06-02T10-00-00-000Z');
    expect(latest?.status).toBe('fail');
  });
});
