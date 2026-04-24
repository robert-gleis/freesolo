import type { AdapterInput, LaunchPlan } from './types.js';

export function buildClaudeLaunchPlan(input: AdapterInput): LaunchPlan {
  return {
    binary: 'claude',
    args: [input.startupPrompt],
    cwd: input.worktreePath
  };
}
