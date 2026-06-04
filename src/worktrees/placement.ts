import type { WorktreeIntent, WorktreeLocation } from './types.js';

export interface WorktreePlacement {
  ensure(intent: WorktreeIntent): Promise<WorktreeLocation>;
  list(): Promise<WorktreeLocation[]>;
  remove(location: WorktreeLocation): Promise<void>;
}

export interface InMemoryWorktreePlacementOptions {
  pathFor?: (intent: WorktreeIntent) => string;
}

export class InMemoryWorktreePlacement implements WorktreePlacement {
  private readonly locations = new Map<string, WorktreeLocation>();
  private readonly pathFor: (intent: WorktreeIntent) => string;

  constructor(options: InMemoryWorktreePlacementOptions = {}) {
    this.pathFor = options.pathFor ?? ((intent) => `/inmem/${intent.branchName}`);
  }

  async ensure(intent: WorktreeIntent): Promise<WorktreeLocation> {
    const existing = this.locations.get(intent.branchName);
    if (existing) {
      return existing;
    }

    const location: WorktreeLocation = {
      path: this.pathFor(intent),
      branchName: intent.branchName
    };
    this.locations.set(intent.branchName, location);
    return location;
  }

  async list(): Promise<WorktreeLocation[]> {
    return Array.from(this.locations.values());
  }

  async remove(location: WorktreeLocation): Promise<void> {
    this.locations.delete(location.branchName);
  }
}
