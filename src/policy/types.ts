import type { AppendEventInput } from '../event-log/types.js';
import type { TeamDefinition } from '../planner/schemas/team-definition.js';
import type { RepoRef } from '../workflow/state-store.js';

export interface AutonomousApprovalInput {
  repoRoot: string;
  worktreePath: string;
  repo: RepoRef;
  issueNumber: number;
  teamPlanPath: string;
}

export type AutonomousApprovalResult =
  | { status: 'skipped' }
  | { status: 'approved'; teamPlanPath: string };

export interface AutonomousApprovalDeps {
  resolveAutonomousMode: (repoRoot: string) => Promise<boolean>;
  readTeamPlan: (worktreePath: string) => Promise<TeamDefinition>;
  writeState: (
    repo: RepoRef,
    issue: number,
    from: 'planned',
    to: 'approved'
  ) => Promise<void>;
  appendEvent: (input: AppendEventInput) => void;
}
