import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';

import { MergeReadinessError, type MergeReadinessRecord } from '../../src/integration/merge-types.js';
import {
  MultipleMergeLabelVerdictsError,
  readMergeLabelStatus,
  readMergeReadinessRecord,
  writeMergeLabelVerdict,
  writeMergeReadinessRecord
} from '../../src/integration/merge-store.js';
import type { GhRunner } from '../../src/core/gh.js';

const repo = { owner: 'acme', repo: 'widgets' };

function fakeGh(responses: Record<string, { stdout: string; stderr: string; exitCode: number }>): GhRunner {
  return async (args) => {
    const key = args.join(' ');
    const hit = Object.entries(responses).find(([prefix]) => key.startsWith(prefix));
    if (!hit) {
      throw new Error(`unexpected gh call: ${key}`);
    }
    return hit[1];
  };
}

const sampleRecord: MergeReadinessRecord = {
  schemaVersion: 1,
  issueNumber: 44,
  outcome: 'ready',
  checks: [],
  verificationRunId: 'run-1',
  pullRequestNumber: 99,
  prCommentId: null,
  reason: 'ok',
  nextAction: 'merge',
  evaluatedAt: '2026-06-08T08:00:00.000Z'
};

describe('merge store', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('round-trips merge-readiness.json', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-store-'));
    await execa('git', ['init'], { cwd: tmpDir });

    await writeMergeReadinessRecord(tmpDir, sampleRecord);
    const loaded = await readMergeReadinessRecord(tmpDir);
    expect(loaded).toEqual(sampleRecord);
  });

  it('returns null when record is missing', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-store-'));
    await execa('git', ['init'], { cwd: tmpDir });
    expect(await readMergeReadinessRecord(tmpDir)).toBeNull();
  });

  it('throws invalid-record on malformed JSON', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'merge-store-'));
    await execa('git', ['init'], { cwd: tmpDir });
    const recordPath = path.join(tmpDir, '.git', 'freesolo', 'merge-readiness.json');
    await fs.mkdir(path.dirname(recordPath), { recursive: true });
    await fs.writeFile(recordPath, '{not-json');

    await expect(readMergeReadinessRecord(tmpDir)).rejects.toBeInstanceOf(MergeReadinessError);
  });

  it('readMergeLabelStatus returns null when no merge label', async () => {
    const gh = fakeGh({
      'issue view 44': {
        stdout: JSON.stringify({ labels: [{ name: 'enhancement' }] }),
        stderr: '',
        exitCode: 0
      }
    });
    expect(await readMergeLabelStatus(repo, 44, { gh })).toBeNull();
  });

  it('writeMergeLabelVerdict swaps labels', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push(args);
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    await writeMergeLabelVerdict(repo, 44, null, 'ready', { gh });
    expect(calls.some((args) => args.includes('merge:ready'))).toBe(true);
    expect(calls.some((args) => args[0] === 'label' && args[1] === 'create')).toBe(true);
  });

  it('throws MultipleMergeLabelVerdictsError for duplicate labels', async () => {
    const gh = fakeGh({
      'issue view 44': {
        stdout: JSON.stringify({
          labels: [{ name: 'merge:ready' }, { name: 'merge:blocked' }]
        }),
        stderr: '',
        exitCode: 0
      }
    });

    await expect(readMergeLabelStatus(repo, 44, { gh })).rejects.toBeInstanceOf(
      MultipleMergeLabelVerdictsError
    );
  });
});
