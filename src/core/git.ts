import { execa } from 'execa';

import type { RepoContext } from './types.js';

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
    throw new Error('issueflow must be started inside a git repository');
  }
}

export async function readOriginRemote(cwd: string): Promise<string> {
  try {
    const { stdout } = await execa('git', ['remote', 'get-url', 'origin'], { cwd });
    return stdout.trim();
  } catch {
    throw new Error('issueflow requires an origin remote that points at GitHub');
  }
}
