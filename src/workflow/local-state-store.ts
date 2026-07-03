import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RepoRef } from '../core/types.js';
import { assertTransition, WORKFLOW_STATES, type WorkflowState } from './state-machine.js';

export class MalformedStateError extends Error {
  readonly issueNumber: number;

  constructor(issueNumber: number, state: string) {
    super(
      `Local state file for issue #${issueNumber} contains unrecognised state "${state}". Repair manually before retrying.`
    );
    this.name = 'MalformedStateError';
    this.issueNumber = issueNumber;
  }
}

function stateFilePath(repo: RepoRef, issueNumber: number): string {
  return path.join(os.homedir(), '.issueflow', 'state', repo.owner, repo.repo, `${issueNumber}`);
}

export async function readState(repo: RepoRef, issueNumber: number): Promise<WorkflowState | null> {
  const filePath = stateFilePath(repo, issueNumber);
  let content: string;
  try {
    content = (await fs.readFile(filePath, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  if (!(WORKFLOW_STATES as readonly string[]).includes(content)) {
    throw new MalformedStateError(issueNumber, content);
  }

  return content as WorkflowState;
}

export async function initializeState(
  repo: RepoRef,
  issueNumber: number,
  initialState: WorkflowState
): Promise<void> {
  if (initialState === 'closed') {
    throw new Error(`Issue #${issueNumber} cannot be initialized to terminal state "closed"`);
  }

  if (!(WORKFLOW_STATES as readonly string[]).includes(initialState)) {
    throw new Error(
      `Issue #${issueNumber} cannot be initialized to unrecognised state "${initialState}"`
    );
  }

  const existing = await readState(repo, issueNumber);
  if (existing !== null) {
    throw new Error(`Issue #${issueNumber} already has local workflow state "${existing}"`);
  }

  const filePath = stateFilePath(repo, issueNumber);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, initialState, 'utf8');
}

export async function writeState(
  repo: RepoRef,
  issueNumber: number,
  from: WorkflowState,
  to: WorkflowState
): Promise<void> {
  assertTransition(from, to);

  if (from === to) {
    return;
  }

  const filePath = stateFilePath(repo, issueNumber);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, to, 'utf8');
}
