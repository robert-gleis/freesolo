import type { AdapterInput, LaunchPlan } from './types.js';

export function buildCursorLaunchPlan(input: Pick<AdapterInput, 'worktreePath'>): LaunchPlan {
  return {
    binary: 'cursor',
    args: [input.worktreePath],
    cwd: input.worktreePath,
    postLaunchNote: 'Run the reusable issueflow command after Cursor opens the worktree.'
  };
}
