export interface AdapterInput {
  worktreePath: string;
  startupPrompt: string;
}

export interface LaunchPlan {
  binary: string;
  args: string[];
  cwd: string;
  postLaunchNote?: string;
}

export type LaunchPlanBuilder = (input: AdapterInput) => LaunchPlan;
