import { openStateStore } from '../state-store/index.js';
import type { StateStoreOptions } from '../state-store/types.js';

import {
  detectWorktreeDrift,
  loadDriftCandidates,
  type WorktreeDriftEntry,
  type WorktreeDriftReport
} from './drift.js';
import {
  WorktreeMetadataStore,
  WorktreeNotFoundError,
  type UpsertWorktreeInput,
  type WorktreeRecord
} from './store.js';

export {
  detectWorktreeDrift,
  loadDriftCandidates,
  WorktreeMetadataStore,
  WorktreeNotFoundError,
  type UpsertWorktreeInput,
  type WorktreeDriftEntry,
  type WorktreeDriftReport,
  type WorktreeRecord
};

export interface OpenWorktreeMetadataResult {
  store: WorktreeMetadataStore;
  close: () => void;
}

export function openWorktreeMetadata(options: StateStoreOptions = {}): OpenWorktreeMetadataResult {
  const stateStore = openStateStore(options);

  return {
    store: new WorktreeMetadataStore(stateStore),
    close: () => stateStore.close()
  };
}

/** @deprecated Use `openWorktreeMetadata` — kept for command deps injection shape. */
export function getWorktreeStore(options: StateStoreOptions = {}): WorktreeMetadataStore {
  return openWorktreeMetadata(options).store;
}
