import type {
  WorktreeId,
  WorktreeIntent,
  WorktreeOrphan,
  WorktreeOrphanReport,
  WorktreeOwner,
  WorktreeRecord
} from './types.js';

export interface AcquireInput {
  owner: WorktreeOwner;
  intent: WorktreeIntent;
  now?: Date;
}

export interface ReleaseInput {
  id: WorktreeId;
  deleteOnDisk?: boolean;
}

export interface WorktreeManager {
  acquire(input: AcquireInput): Promise<WorktreeRecord>;
  release(input: ReleaseInput): Promise<void>;

  get(id: WorktreeId): Promise<WorktreeRecord | null>;
  findByOwner(owner: WorktreeOwner): Promise<WorktreeRecord | null>;
  list(): Promise<WorktreeRecord[]>;

  touch(id: WorktreeId, now?: Date): Promise<void>;

  findOrphans(now?: Date): Promise<WorktreeOrphanReport>;
  reap(orphan: WorktreeOrphan, now?: Date): Promise<void>;
}
