import { execa } from 'execa';

import type { RepoRef } from '../core/types.js';
import { assertTransition, WORKFLOW_STATES, type WorkflowState } from './state-machine.js';

export const STATE_LABEL_PREFIX = 'state:';

export type { RepoRef };

export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GhRunner = (args: string[]) => Promise<GhResult>;

export interface StateStoreDeps {
  gh?: GhRunner;
}

export const defaultRunner: GhRunner = async (args) => {
  try {
    const result = await execa('gh', args);
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      exitCode: result.exitCode ?? 0
    };
  } catch (error) {
    const execaError = error as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };

    if (execaError?.exitCode === undefined) {
      throw new Error('issueflow requires GitHub CLI access. Run `gh auth status` and retry.');
    }

    return {
      stdout: execaError.stdout ?? '',
      stderr: execaError.stderr ?? '',
      exitCode: execaError.exitCode
    };
  }
};

const STATE_LABEL_COLOR = 'C5DEF5';

interface IssueLabelsResponse {
  labels?: Array<{ name?: string }>;
}

function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

function labelFor(state: WorkflowState): string {
  return `${STATE_LABEL_PREFIX}${state}`;
}

function parseState(label: string): WorkflowState | null {
  if (!label.startsWith(STATE_LABEL_PREFIX)) {
    return null;
  }
  const candidate = label.slice(STATE_LABEL_PREFIX.length);
  return (WORKFLOW_STATES as readonly string[]).includes(candidate)
    ? (candidate as WorkflowState)
    : null;
}

export class MultipleStateLabelsError extends Error {
  readonly issueNumber: number;
  readonly labels: string[];

  constructor(issueNumber: number, labels: string[]) {
    super(
      `Issue #${issueNumber} has multiple workflow state labels: ${labels.join(', ')}. Repair manually before retrying.`
    );
    this.name = 'MultipleStateLabelsError';
    this.issueNumber = issueNumber;
    this.labels = labels;
  }
}

export async function readState(
  repo: RepoRef,
  issueNumber: number,
  deps: StateStoreDeps = {}
): Promise<WorkflowState | null> {
  const gh = deps.gh ?? defaultRunner;
  const result = await gh([
    'issue',
    'view',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--json',
    'labels'
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to read labels for issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`);
  }

  const payload = JSON.parse(result.stdout || '{}') as IssueLabelsResponse;
  const states = (payload.labels ?? [])
    .map((label) => parseState(label.name ?? ''))
    .filter((value): value is WorkflowState => value !== null);

  if (states.length === 0) {
    return null;
  }

  if (states.length > 1) {
    throw new MultipleStateLabelsError(issueNumber, states);
  }

  return states[0];
}

async function createStateLabel(repo: RepoRef, state: WorkflowState, gh: GhRunner): Promise<void> {
  const result = await gh([
    'label',
    'create',
    labelFor(state),
    '--repo',
    repoSlug(repo),
    '--color',
    STATE_LABEL_COLOR,
    '--description',
    `IssueFlow workflow state: ${state}`,
    '--force'
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create label ${labelFor(state)}: ${result.stderr.trim() || 'gh exited non-zero'}`);
  }
}

export async function writeState(
  repo: RepoRef,
  issueNumber: number,
  from: WorkflowState,
  to: WorkflowState,
  deps: StateStoreDeps = {}
): Promise<void> {
  assertTransition(from, to);

  if (from === to) {
    return;
  }

  const gh = deps.gh ?? defaultRunner;

  await createStateLabel(repo, to, gh);

  const result = await gh([
    'issue',
    'edit',
    String(issueNumber),
    '--repo',
    repoSlug(repo),
    '--remove-label',
    labelFor(from),
    '--add-label',
    labelFor(to)
  ]);

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to swap state labels on issue #${issueNumber}: ${result.stderr.trim() || 'gh exited non-zero'}`
    );
  }
}

export async function ensureStateLabels(repo: RepoRef, deps: StateStoreDeps = {}): Promise<void> {
  const gh = deps.gh ?? defaultRunner;
  for (const state of WORKFLOW_STATES) {
    await createStateLabel(repo, state, gh);
  }
}
