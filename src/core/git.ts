import { execa } from 'execa';

import type { RepoContext, RepoRef } from './types.js';

export class NotAGitRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAGitRepositoryError';
  }
}

export class MissingOriginRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingOriginRemoteError';
  }
}

export function parseGitHubRemote(remoteUrl: string): RepoContext | null {
  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/(.+)\.git$/);
  if (sshMatch) {
    return {
      host: sshMatch[1],
      owner: sshMatch[2],
      repo: sshMatch[3],
      remoteUrl,
      rootDir: ''
    };
  }

  const httpsMatch = remoteUrl.match(/^https:\/\/([^/]+)\/([^/]+)\/(.+)\.git$/);
  if (httpsMatch) {
    return {
      host: httpsMatch[1],
      owner: httpsMatch[2],
      repo: httpsMatch[3],
      remoteUrl,
      rootDir: ''
    };
  }

  return null;
}

export async function resolveRepoRoot(cwd: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['rev-parse', '--show-toplevel'], { cwd });
    return stdout.trim();
  } catch {
    throw new NotAGitRepositoryError('freesolo must be started inside a git repository');
  }
}

export async function readOriginRemote(cwd: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    return stdout.trim();
  } catch {
    throw new MissingOriginRemoteError('freesolo requires an origin remote that points at GitHub');
  }
}

export async function resolveRepoRef(cwd: string): Promise<RepoRef> {
  const repoRoot = await resolveRepoRoot(cwd);
  const remoteUrl = await readOriginRemote(repoRoot);
  const parsed = parseGitHubRemote(remoteUrl);
  if (!parsed) {
    throw new Error('origin is not a supported GitHub remote');
  }
  return { owner: parsed.owner, repo: parsed.repo };
}

/** Runs `git <args>` in `cwd` and returns raw stdout. Injectable for tests. */
export type GitRunner = (args: string[], cwd: string) => Promise<string>;

const defaultGitRunner: GitRunner = async (args, cwd) => {
  const { stdout } = await execa('git', args, { cwd });
  return stdout;
};

export interface BranchDiffOptions {
  cwd: string;
  base?: string;
  run?: GitRunner;
}

/**
 * Returns the candidate diff of HEAD against its merge-base with `base`
 * (default 'main'), i.e. only what this branch introduced. Uses two-dot range
 * `<merge-base>..HEAD` so unrelated changes on `base` are excluded.
 */
export async function getBranchDiff(options: BranchDiffOptions): Promise<string> {
  const { cwd, base = 'main', run = defaultGitRunner } = options;
  const mergeBase = (await run(['merge-base', base, 'HEAD'], cwd)).trim();
  return run(['diff', `${mergeBase}..HEAD`], cwd);
}
