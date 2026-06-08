export type CandidateBranchErrorCode =
  | 'no-sources'
  | 'branch-not-found'
  | 'git-error'
  | 'invalid-record'
  | 'slug-not-found';

export class CandidateBranchError extends Error {
  readonly code: CandidateBranchErrorCode;

  constructor(code: CandidateBranchErrorCode, message: string) {
    super(message);
    this.name = 'CandidateBranchError';
    this.code = code;
  }
}

export interface CandidateBranchSource {
  branchName: string;
  ownerKind: 'agent' | 'team';
  ownerId: string;
}

export interface CreateCandidateBranchInput {
  repoRoot: string;
  issueNumber: number;
  issueSlug: string;
  teamId: string;
  sources: CandidateBranchSource[];
  baseBranch?: string;
  force?: boolean;
}

export interface CandidateBranchRecord {
  branchName: string;
  issueNumber: number;
  issueSlug: string;
  teamId: string;
  sources: CandidateBranchSource[];
  baseBranch: string;
  mergeCommitSha: string | null;
  status: 'ready' | 'conflict';
  createdAt: string;
  updatedAt: string;
}

export type CandidateBranchOutcome =
  | { status: 'created'; branchName: string; mergeCommitSha: string; record: CandidateBranchRecord }
  | {
      status: 'conflict';
      branchName: string;
      conflictingBranch: string;
      conflictedFiles: string[];
      gitOutput: string;
      record: CandidateBranchRecord;
    }
  | { status: 'already-exists'; branchName: string; record: CandidateBranchRecord };
