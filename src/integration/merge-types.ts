import type { IssueArtifactPaths } from '../core/types.js';
import type { VerificationRun } from '../verification/types.js';
import type { VerdictStatus } from '../verification/verdict-store.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import type { CandidateBranchRecord } from './types.js';
import type { PullRequestRecord } from './pr-types.js';

export type MergeReadinessErrorCode = 'invalid-record' | 'no-pull-request' | 'gh-error';

export class MergeReadinessError extends Error {
  readonly code: MergeReadinessErrorCode;

  constructor(code: MergeReadinessErrorCode, message: string) {
    super(message);
    this.name = 'MergeReadinessError';
    this.code = code;
  }
}

export type MergeGateCheckStatus = 'pass' | 'fail' | 'skip';

export interface MergeGateCheck {
  id: string;
  label: string;
  status: MergeGateCheckStatus;
  detail: string;
}

export type MergeReadinessOutcome = 'ready' | 'blocked';

export interface MergeReadinessEvaluation {
  outcome: MergeReadinessOutcome;
  checks: MergeGateCheck[];
  reason: string;
  nextAction: string;
}

export interface MergePolicyConfig {
  requireCandidateBranch: boolean;
  requireImplementationReview: boolean;
}

export interface MergeReadinessInput {
  issueNumber: number;
  state: WorkflowState | null;
  verdict: VerdictStatus | null;
  verdictRunId: string | null;
  latestRun: VerificationRun | null;
  artifacts: IssueArtifactPaths;
  pullRequest: PullRequestRecord | null;
  prState: 'OPEN' | 'CLOSED' | 'MERGED' | null;
  candidateRecord: CandidateBranchRecord | null;
  policy: MergePolicyConfig;
}

export interface MergeReadinessRecord {
  schemaVersion: 1;
  issueNumber: number;
  outcome: MergeReadinessOutcome;
  checks: MergeGateCheck[];
  verificationRunId: string | null;
  pullRequestNumber: number | null;
  prCommentId: string | null;
  reason: string;
  nextAction: string;
  evaluatedAt: string;
  mergedAt?: string;
}

export type MergeLabelStatus = 'ready' | 'blocked';
