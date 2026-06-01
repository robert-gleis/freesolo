export type HostTool = 'codex' | 'claude' | 'cursor';
export type ReviewGateStatus = 'pending' | 'pass' | 'pass_with_findings' | 'block';

export interface ReviewLoopState {
  currentRound: number;
  maxRounds: 5;
}

export interface ReviewLoopsState {
  plan: ReviewLoopState;
  implementation: ReviewLoopState;
}

export interface RepoContext {
  host: string;
  owner: string;
  repo: string;
  remoteUrl: string;
  rootDir: string;
}

export interface IssueSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
  assignees: string[];
  slug: string;
  status: string | null;
}

export interface IssueArtifactPaths {
  spec: string | null;
  plan: string | null;
  planReview: string | null;
  implementationReview: string | null;
}

export interface ExistingWorkspaceMatch {
  branchName: string;
  worktreePath?: string;
}

export interface WorktreeEntry {
  branchName: string;
  worktreePath: string;
}

export type RepoRef = Pick<RepoContext, 'owner' | 'repo'>;
