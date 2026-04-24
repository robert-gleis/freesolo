import type { AdapterInput, LaunchPlan } from './types.js';

export function buildCodexLaunchPlan(input: AdapterInput): LaunchPlan {
  return {
    binary: 'codex',
    args: ['-C', input.worktreePath, input.startupPrompt],
    cwd: input.worktreePath
  };
}
