import { buildClaudeLaunchPlan } from './claude.js';
import { buildCodexLaunchPlan } from './codex.js';
import { buildCursorLaunchPlan } from './cursor.js';
import type { LaunchPlanBuilder } from './types.js';
import type { HostTool } from '../core/types.js';

export { buildCodexLaunchPlan, buildClaudeLaunchPlan, buildCursorLaunchPlan };

const adapters: Record<HostTool, LaunchPlanBuilder> = {
  codex: buildCodexLaunchPlan,
  claude: buildClaudeLaunchPlan,
  cursor: buildCursorLaunchPlan
};

export function getAdapter(tool: HostTool): LaunchPlanBuilder {
  return adapters[tool];
}
