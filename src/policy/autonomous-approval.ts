import { resolveAutonomousMode } from './config.js';
import { buildTeamPlannedEvent } from './events.js';
import type {
  AutonomousApprovalDeps,
  AutonomousApprovalInput,
  AutonomousApprovalResult
} from './types.js';

const defaultDeps: AutonomousApprovalDeps = {
  resolveAutonomousMode,
  readTeamPlan: async () => {
    throw new Error('readTeamPlan dep not injected');
  },
  writeState: async () => {
    throw new Error('writeState dep not injected');
  },
  appendEvent: () => {
    throw new Error('appendEvent dep not injected');
  }
};

export async function maybeAutoApproveTeamPlan(
  input: AutonomousApprovalInput,
  deps: Partial<AutonomousApprovalDeps> = {}
): Promise<AutonomousApprovalResult> {
  const merged = { ...defaultDeps, ...deps };
  const enabled = await merged.resolveAutonomousMode(input.repoRoot);
  if (!enabled) {
    return { status: 'skipped' };
  }

  await merged.readTeamPlan(input.worktreePath);
  await merged.writeState(input.repo, input.issueNumber, 'planned', 'approved');
  merged.appendEvent(buildTeamPlannedEvent(input.issueNumber, input.teamPlanPath));
  return { status: 'approved', teamPlanPath: input.teamPlanPath };
}
