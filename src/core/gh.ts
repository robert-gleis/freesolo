import { execa } from 'execa';

import type { RepoRef } from './types.js';

export function repoSlug(repo: RepoRef): string {
  return `${repo.owner}/${repo.repo}`;
}

export interface GhResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type GhRunner = (args: string[]) => Promise<GhResult>;

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
