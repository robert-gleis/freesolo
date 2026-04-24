import type { AdapterInput, LaunchPlan } from './types.js';

export function buildCursorLaunchPlan(input: AdapterInput): LaunchPlan {
  return {
    binary: 'cursor-agent',
    args: ['--workspace', input.worktreePath, input.startupPrompt],
    cwd: input.worktreePath
  };
}
