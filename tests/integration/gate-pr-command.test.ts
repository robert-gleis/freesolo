import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { gateEvaluateAction, type GateCommandDeps } from '../../src/commands/gate.js';
import { prCreateAction, type PrCommandDeps } from '../../src/commands/pr.js';
import { loadLatestRun, writeRun } from '../../src/verification/store.js';
import {
  readGateVerdictRecord,
  writeGateVerdictRecord
} from '../../src/verification/verdict-store.js';
import type { VerificationRun } from '../../src/verification/types.js';
import type { RepoRef } from '../../src/core/types.js';

const tempDirs: string[] = [];

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issueflow-gate-int-'));
  tempDirs.push(dir);
  await execa('git', ['init', '--quiet'], { cwd: dir });
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function makePassRun(repoRoot: string, issueNumber: number, runId: string): VerificationRun {
  return {
    schemaVersion: 1,
    runId,
    issueNumber,
    repoRoot,
    configPath: path.join(repoRoot, 'issueflow.config.json'),
    startedAt: '2026-06-01T08:00:00.000Z',
    finishedAt: '2026-06-01T08:01:00.000Z',
    status: 'pass',
    bail: false,
    checks: []
  };
}

function makeFailRun(repoRoot: string, issueNumber: number, runId: string): VerificationRun {
  return { ...makePassRun(repoRoot, issueNumber, runId), status: 'fail' };
}

function makePrDeps(input: {
  repoRoot: string;
  repo: RepoRef;
  issueNumber: number;
  readGateVerdictRecord?: PrCommandDeps['readGateVerdictRecord'];
  setExitCode: (code: number) => void;
}): PrCommandDeps {
  return {
    resolveRepoRoot: async () => input.repoRoot,
    resolveRepoRef: async () => input.repo,
    resolveIssueNumber: async () => input.issueNumber,
    readState: async () => 'pr-ready',
    readVerdict: async () => 'pass',
    loadLatestRun,
    readGateVerdictRecord: input.readGateVerdictRecord ?? readGateVerdictRecord,
    createPullRequest: async () => {
      throw new Error('createPullRequest should not be called in print-only mode');
    },
    readPullRequestRecord: async () => null,
    runGh: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    runGit: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    write: () => {},
    setExitCode: input.setExitCode
  };
}

describe('gate evaluate + pr create (integration)', () => {
  it('gate evaluate writes gate-verdict.json and pr create --print-only exits 0', async () => {
    const repoRoot = await makeRepo();
    const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
    const issueNumber = 29;
    const runId = '2026-06-01T08-00-00-000Z';
    const passRun = makePassRun(repoRoot, issueNumber, runId);

    await writeRun(passRun);

    let gateExitCode = 99;
    let writtenState: string | null = null;
    let writtenVerdict: string | null = null;

    const gateDeps: GateCommandDeps = {
      resolveRepoRoot: async () => repoRoot,
      resolveRepoRef: async () => repo,
      resolveIssueNumber: async () => issueNumber,
      readState: async () => 'verifying',
      writeState: async (_r, _n, _from, to) => {
        writtenState = to;
      },
      readVerdict: async () => null,
      writeVerdict: async (_r, _n, _from, to) => {
        writtenVerdict = to;
      },
      loadLatestRun,
      writeGateVerdictRecord,
      env: { ISSUEFLOW_ENGINE: '1' },
      write: () => {},
      setExitCode: (code) => {
        gateExitCode = code;
      },
      now: () => new Date('2026-06-01T08:02:00.000Z')
    };

    await gateEvaluateAction({ issue: undefined }, gateDeps);

    expect(gateExitCode).toBe(0);
    expect(writtenState).toBe('pr-ready');
    expect(writtenVerdict).toBe('pass');

    const record = await readGateVerdictRecord(repoRoot, issueNumber);
    expect(record).not.toBeNull();
    expect(record?.outcome).toBe('pass');
    expect(record?.runId).toBe(runId);
    expect(record?.evaluatedAt).toBe('2026-06-01T08:02:00.000Z');

    let prExitCode = 99;

    const prDeps = makePrDeps({
      repoRoot,
      repo,
      issueNumber,
      setExitCode: (code) => {
        prExitCode = code;
      }
    });

    await prCreateAction({ issue: undefined, printOnly: true }, prDeps);

    expect(prExitCode).toBe(0);
  });

  it('pr create --print-only exits 1 when latest run is newer and failing (stale verdict)', async () => {
    const repoRoot = await makeRepo();
    const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
    const issueNumber = 29;
    const passRunId = '2026-06-01T08-00-00-000Z';
    const failRunId = '2026-06-01T09-00-00-000Z';

    await writeRun(makePassRun(repoRoot, issueNumber, passRunId));
    await writeGateVerdictRecord(repoRoot, issueNumber, {
      schemaVersion: 1,
      issueNumber,
      runId: passRunId,
      outcome: 'pass',
      reason: 'run passed',
      nextAction: 'pr',
      evaluatedAt: '2026-06-01T08:02:00.000Z'
    });
    await writeRun(makeFailRun(repoRoot, issueNumber, failRunId));

    let prExitCode = 99;

    const prDeps = makePrDeps({
      repoRoot,
      repo,
      issueNumber,
      setExitCode: (code) => {
        prExitCode = code;
      }
    });

    await prCreateAction({ issue: undefined, printOnly: true }, prDeps);

    expect(prExitCode).toBe(1);
  });

  it('pr create --print-only exits 1 when latest run itself failed', async () => {
    const repoRoot = await makeRepo();
    const repo: RepoRef = { owner: 'acme', repo: 'widgets' };
    const issueNumber = 29;
    const failRunId = '2026-06-01T09-00-00-000Z';

    await writeRun(makeFailRun(repoRoot, issueNumber, failRunId));

    let prExitCode = 99;

    const prDeps = makePrDeps({
      repoRoot,
      repo,
      issueNumber,
      readGateVerdictRecord: async () => ({
        schemaVersion: 1 as const,
        issueNumber,
        runId: failRunId,
        outcome: 'pass' as const,
        reason: 'stale pass',
        nextAction: 'pr',
        evaluatedAt: '2026-06-01T09:01:00.000Z'
      }),
      setExitCode: (code) => {
        prExitCode = code;
      }
    });

    await prCreateAction({ issue: undefined, printOnly: true }, prDeps);

    expect(prExitCode).toBe(1);
  });
});
