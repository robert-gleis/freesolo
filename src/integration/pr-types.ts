import type { GitCommandRunner } from './integrator.js';

export type PullRequestErrorCode =
  | 'candidate-not-ready'
  | 'verification-not-passed'
  | 'review-artifact-missing'
  | 'summary-unavailable'
  | 'gh-error'
  | 'git-error'
  | 'invalid-record';

export class PullRequestError extends Error {
  readonly code: PullRequestErrorCode;

  constructor(code: PullRequestErrorCode, message: string) {
    super(message);
    this.name = 'PullRequestError';
    this.code = code;
  }
}

export interface CreatePullRequestInput {
  repoRoot: string;
  issueNumber: number;
  baseBranch?: string;
  dryRun?: boolean;
}

export interface PullRequestRecord {
  issueNumber: number;
  issueSlug: string;
  prNumber: number;
  prUrl: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  verificationRunId: string;
  implementationReviewPath: string;
  specPath: string | null;
  createdAt: string;
}

export type PullRequestOutcome =
  | { status: 'created'; prNumber: number; prUrl: string; record: PullRequestRecord }
  | { status: 'already-exists'; prNumber: number; prUrl: string; record: PullRequestRecord }
  | { status: 'dry-run'; title: string; body: string; headBranch: string; baseBranch: string };

export type GhCommandRunner = (
  args: string[],
  options: { cwd: string; input?: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface PullRequestCreatorDeps {
  runGh: GhCommandRunner;
  runGit: GitCommandRunner;
  readFile: typeof import('node:fs/promises').readFile;
  writeFile: typeof import('node:fs/promises').writeFile;
  now?: () => Date;
}
