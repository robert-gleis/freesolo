import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { VerificationRun } from './types.js';

async function gitIssueflowPath(repoRoot: string, ...segments: string[]): Promise<string> {
  const joined = ['issueflow', ...segments].join('/');
  const { stdout } = await execa('git', ['rev-parse', '--git-path', joined], { cwd: repoRoot });
  const resolved = stdout.trim();
  return path.isAbsolute(resolved) ? resolved : path.join(repoRoot, resolved);
}

export async function getIssueVerificationsDir(repoRoot: string, issueNumber: number): Promise<string> {
  return gitIssueflowPath(repoRoot, 'verifications', `issue-${issueNumber}`);
}

export async function getRunDirectory(repoRoot: string, issueNumber: number, runId: string): Promise<string> {
  return gitIssueflowPath(repoRoot, 'verifications', `issue-${issueNumber}`, runId);
}

/**
 * Intentionally not called by the pipeline — the runner writes `run.json` itself
 * so that partial runs persist even if log writes fail. Exported for use by tests
 * and future consumers (e.g. tooling that imports already-built runs).
 */
export async function writeRun(run: VerificationRun): Promise<void> {
  const runDir = await getRunDirectory(run.repoRoot, run.issueNumber, run.runId);
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
}

async function readRunJson(runJsonPath: string): Promise<VerificationRun | null> {
  try {
    const raw = await fs.readFile(runJsonPath, 'utf8');
    return JSON.parse(raw) as VerificationRun;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return null;
    }

    throw error;
  }
}

export async function listRuns(repoRoot: string, issueNumber: number): Promise<VerificationRun[]> {
  const dir = await getIssueVerificationsDir(repoRoot, issueNumber);
  let entries: string[];

  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const sortedDesc = entries.slice().sort().reverse();
  const runs: VerificationRun[] = [];

  for (const entry of sortedDesc) {
    const run = await readRunJson(path.join(dir, entry, 'run.json'));

    if (run) {
      runs.push(run);
    }
  }

  return runs;
}

export async function loadLatestRun(repoRoot: string, issueNumber: number): Promise<VerificationRun | null> {
  const [latest] = await listRuns(repoRoot, issueNumber);
  return latest ?? null;
}
