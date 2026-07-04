// Staged, not yet wired: no production caller imports this module. The Runner
// abstraction is groundwork for issue #27 (Docker Runner); see CONTEXT.md "Runner".
export type {
  LogOptions,
  LogSnapshot,
  Runner,
  RunnerErrorCode,
  RunnerId,
  RunnerState,
  RunnerStatus,
  SpawnSpec
} from './types.js';
export { RunnerError } from './types.js';

export { ScriptedRunner } from './scripted.js';
export type { ScriptedRunnerScript } from './scripted.js';

export { LocalProcessRunner } from './local.js';
export type {
  LocalProcessRunnerDeps,
  LocalProcessRunnerOptions,
  SpawnProcess,
  SpawnProcessResult
} from './local.js';

export { TmuxRunner } from './tmux.js';
export type { TmuxRunnerDeps } from './tmux.js';
