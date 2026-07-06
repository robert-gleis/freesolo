import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import { getFreesoloPath } from './session-state.js';

const branchPattern = /^issue\/(\d+)-/;

export class IssueIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IssueIdError';
  }
}

export interface ResolveIssueNumberDeps {
  readSessionFile: (worktreePath: string) => Promise<{ issueNumber?: number } | null>;
  readCurrentBranch: (worktreePath: string) => Promise<string | null>;
}

const defaultDeps: ResolveIssueNumberDeps = {
  readSessionFile: async (worktreePath) => {
    try {
      const sessionPath = await getFreesoloPath(worktreePath, 'session.json');
      const resolved = path.isAbsolute(sessionPath) ? sessionPath : path.join(worktreePath, sessionPath);
      const raw = await fs.readFile(resolved, 'utf8');
      return JSON.parse(raw) as { issueNumber?: number };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  },
  readCurrentBranch: async (worktreePath) => {
    try {
      const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath });
      const trimmed = stdout.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  }
};

export async function resolveIssueNumber(
  worktreePath: string,
  override: number | undefined,
  deps: ResolveIssueNumberDeps = defaultDeps
): Promise<number> {
  if (override !== undefined) {
    if (!Number.isInteger(override) || override <= 0) {
      throw new IssueIdError(`freesolo verify --issue must be a positive integer (got ${override}).`);
    }
    return override;
  }

  const session = await deps.readSessionFile(worktreePath);

  if (session?.issueNumber && Number.isFinite(session.issueNumber)) {
    return session.issueNumber;
  }

  const branch = await deps.readCurrentBranch(worktreePath);

  if (branch) {
    const match = branchPattern.exec(branch);

    if (match) {
      return Number(match[1]);
    }
  }

  throw new IssueIdError(
    'freesolo verify needs an --issue <number> or an freesolo session in the current worktree.'
  );
}
