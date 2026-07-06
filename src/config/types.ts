import type { WorkflowState } from '../workflow/state-machine.js';

export const WATCHER_SOURCES = ['assigned-to-me', 'label'] as const;
export type WatcherSource = (typeof WATCHER_SOURCES)[number];
export function isWatcherSource(value: string): value is WatcherSource {
  return (WATCHER_SOURCES as readonly string[]).includes(value);
}

export const WATCHER_INTAKE_MODES = ['confirm', 'auto'] as const;
export type WatcherIntakeMode = (typeof WATCHER_INTAKE_MODES)[number];
export function isWatcherIntakeMode(value: string): value is WatcherIntakeMode {
  return (WATCHER_INTAKE_MODES as readonly string[]).includes(value);
}

export interface WatcherConfig {
  interval_seconds: number;
  source: WatcherSource;
  intake_mode: WatcherIntakeMode;
  initial_state: Exclude<WorkflowState, 'closed'>;
  trigger_label: string;
}

export interface FreesoloConfig {
  watcher: WatcherConfig;
  autonomous_mode: boolean;
}

export const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
  interval_seconds: 60,
  source: 'assigned-to-me',
  intake_mode: 'confirm',
  initial_state: 'triaged',
  trigger_label: 'triaged'
};

export const DEFAULT_CONFIG: FreesoloConfig = {
  watcher: DEFAULT_WATCHER_CONFIG,
  autonomous_mode: false
};

export const MIN_INTERVAL_SECONDS = 5;
