import { execa } from 'execa';

import type { ChildIssue } from '../planner/schemas/decomposition-plan.js';
import type { RepoRef } from '../core/types.js';

export type GhRunner = (
  command: string,
  args: string[]
) => Promise<{ stdout: string; stderr?: string }>;

export class ChildIssueCreationError extends Error {
  readonly childIndex: number;
  readonly stderr?: string;

  constructor(childIndex: number, message: string, stderr?: string) {
    super(`failed to create child issue at index ${childIndex}: ${message}`);
    this.name = 'ChildIssueCreationError';
    this.childIndex = childIndex;
    this.stderr = stderr;
  }
}

export interface CreateChildIssuesInput {
  repo: RepoRef;
  parentIssue: number;
  children: ChildIssue[];
  runGh?: GhRunner;
}

export interface CreatedChildIssue {
  number: number;
  title: string;
  url: string;
}

const PARENT_HEADING = /^## Parent\s*\n+\s*#(\d+)/m;

export function ensureParentSection(body: string, parentIssue: number): string {
  const match = body.match(PARENT_HEADING);
  if (match) {
    const referenced = Number.parseInt(match[1], 10);
    if (referenced !== parentIssue) {
      throw new ChildIssueCreationError(
        -1,
        `child body references parent #${referenced}, expected #${parentIssue}`
      );
    }
    return body;
  }
  return `## Parent\n\n#${parentIssue}\n\n${body}`;
}

export async function defaultRunGh(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr?: string }> {
  const result = await execa(command, args, { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `exit ${result.exitCode}`);
  }
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function createChildIssues(
  input: CreateChildIssuesInput
): Promise<CreatedChildIssue[]> {
  const runGh = input.runGh ?? defaultRunGh;
  const created: CreatedChildIssue[] = [];

  for (let index = 0; index < input.children.length; index++) {
    const child = input.children[index];
    const body = ensureParentSection(child.body, input.parentIssue);
    const args = [
      'issue',
      'create',
      '--repo',
      `${input.repo.owner}/${input.repo.repo}`,
      '--title',
      child.title,
      '--body',
      body,
      '--json',
      'number,url,title'
    ];
    for (const label of child.labels) {
      args.push('--label', label);
    }

    try {
      const { stdout } = await runGh('gh', args);
      const parsed = JSON.parse(stdout) as CreatedChildIssue;
      created.push(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stderr = (error as { stderr?: string }).stderr;
      throw new ChildIssueCreationError(index, message, stderr);
    }
  }

  return created;
}
