import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { InvalidTransitionError } from '../../src/workflow/state-machine.js';
import { initializeState, readState, writeState } from '../../src/workflow/local-state-store.js';

const repo = { owner: 'acme', repo: 'widgets' };

function stateFilePath(issueNumber: number): string {
  return path.join(os.homedir(), '.freesolo', 'state', repo.owner, repo.repo, String(issueNumber));
}

const testIssueNumber = 99_000 + Math.floor(Math.random() * 1000);

afterEach(async () => {
  await fs.unlink(stateFilePath(testIssueNumber)).catch(() => {});
});

describe('readState', () => {
  it('returns null when no file exists', async () => {
    expect(await readState(repo, testIssueNumber)).toBeNull();
  });

  it('returns the stored state', async () => {
    const filePath = stateFilePath(testIssueNumber);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'planned', 'utf8');
    expect(await readState(repo, testIssueNumber)).toBe('planned');
  });

  it('throws on unrecognised state content', async () => {
    const filePath = stateFilePath(testIssueNumber);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'bogus-state', 'utf8');
    await expect(readState(repo, testIssueNumber)).rejects.toThrow(/unrecognised state/);
  });
});

describe('initializeState', () => {
  it('creates the first local state', async () => {
    await initializeState(repo, testIssueNumber, 'triaged');
    expect(await readState(repo, testIssueNumber)).toBe('triaged');
  });

  it('fails when local state already exists', async () => {
    await initializeState(repo, testIssueNumber, 'triaged');
    await expect(initializeState(repo, testIssueNumber, 'planned')).rejects.toThrow(
      /already has local workflow state/
    );
  });

  it('rejects closed as an initial state', async () => {
    await expect(initializeState(repo, testIssueNumber, 'closed')).rejects.toThrow(
      /cannot be initialized to terminal state/
    );
  });
});

describe('writeState', () => {
  it('writes the new state to disk', async () => {
    await writeState(repo, testIssueNumber, 'planned', 'approved');
    const content = await fs.readFile(stateFilePath(testIssueNumber), 'utf8');
    expect(content).toBe('approved');
  });

  it('is idempotent when from equals to', async () => {
    await writeState(repo, testIssueNumber, 'planned', 'planned');
    await expect(fs.access(stateFilePath(testIssueNumber))).rejects.toThrow();
  });

  it('rejects invalid transitions', async () => {
    await expect(writeState(repo, testIssueNumber, 'planned', 'pr-ready')).rejects.toThrow(
      InvalidTransitionError
    );
  });
});
