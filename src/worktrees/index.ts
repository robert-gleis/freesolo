// Staged, not yet wired: no production caller imports this module. The WorktreeManager
// interface is spec-only groundwork; production worktree persistence lives in src/worktree-metadata.
export {
  WorktreeManagerError
} from './types.js';

export type {
  WorktreeId,
  WorktreeIntent,
  WorktreeLocation,
  WorktreeManagerErrorCode,
  WorktreeOrphan,
  WorktreeOrphanKind,
  WorktreeOrphanReport,
  WorktreeOwner,
  WorktreeOwnerKind,
  WorktreeRecord
} from './types.js';

export type {
  AcquireInput,
  ReleaseInput,
  WorktreeManager
} from './manager.js';

export {
  InMemoryWorktreePlacement
} from './placement.js';
export type {
  InMemoryWorktreePlacementOptions,
  WorktreePlacement
} from './placement.js';

export {
  InMemoryWorktreeManager
} from './in-memory.js';
export type {
  InMemoryWorktreeManagerOptions
} from './in-memory.js';
