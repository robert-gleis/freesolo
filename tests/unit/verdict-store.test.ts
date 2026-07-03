import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import type { GhRunner } from '../../src/core/gh.js';
import {
  MultipleVerdictLabelsError,
  readGateVerdictRecord,
  readVerdict,
  writeGateVerdictRecord,
  writeVerdict,
  type GateVerdictRecord,
  type VerdictStatus
} from '../../src/verification/verdict-store.js';

const repo = { owner: 'acme', repo: 'widgets' };

interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function fakeGh(responses: Record<string, GhResult>): GhRunner {
  return async (args) => {
    const key = args.join(' ');
    const hit = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
    if (!hit) {
      throw new Error(`unexpected gh call: ${key}`);
    }
    return hit[1];
  };
}

describe('verdict store', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('readVerdict returns null when no verification label is present', async () => {
    const gh = fakeGh({
      'issue view 29': {
        stdout: JSON.stringify({ labels: [{ name: 'enhancement' }] }),
        stderr: '',
        exitCode: 0
      }
    });

    expect(await readVerdict(repo, 29, { gh })).toBeNull();
  });

  it('readVerdict returns pass when verification:pass is set', async () => {
    const gh = fakeGh({
      'issue view 29': {
        stdout: JSON.stringify({ labels: [{ name: 'verification:pass' }] }),
        stderr: '',
        exitCode: 0
      }
    });

    const result: VerdictStatus | null = await readVerdict(repo, 29, { gh });
    expect(result).toBe('pass');
  });

  it('writeVerdict swaps labels via gh issue edit', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      if (args[0] === 'label' && args[1] === 'create') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (args[0] === 'issue' && args[1] === 'edit') {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      throw new Error(`unexpected: ${args.join(' ')}`);
    };

    await writeVerdict(repo, 29, null, 'pass', { gh });

    const editCall = calls.find((args) => args[0] === 'issue');
    expect(editCall).toContain('--add-label');
    expect(editCall).toContain('verification:pass');
  });

  it('throws MultipleVerdictLabelsError when multiple verdict labels exist', async () => {
    const gh = fakeGh({
      'issue view 29': {
        stdout: JSON.stringify({
          labels: [{ name: 'verification:pass' }, { name: 'verification:fail' }]
        }),
        stderr: '',
        exitCode: 0
      }
    });

    await expect(readVerdict(repo, 29, { gh })).rejects.toBeInstanceOf(MultipleVerdictLabelsError);
  });

  it('roundtrips gate-verdict.json under .git/issueflow/verifications', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verdict-'));
    await execa('git', ['init', '--quiet'], { cwd: tmpDir });

    const record: GateVerdictRecord = {
      schemaVersion: 1,
      issueNumber: 29,
      runId: '2026-06-01T08-00-00-000Z',
      outcome: 'pass',
      reason: 'ok',
      nextAction: 'pr',
      evaluatedAt: '2026-06-01T08:02:00.000Z'
    };

    await writeGateVerdictRecord(tmpDir, 29, record);
    const loaded = await readGateVerdictRecord(tmpDir, 29);
    expect(loaded).toEqual(record);
  });
});
