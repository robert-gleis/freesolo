import type { AcquireInput, ReleaseInput, WorktreeManager } from './manager.js';
import type { WorktreePlacement } from './placement.js';
import {
  WorktreeManagerError,
  type WorktreeId,
  type WorktreeIntent,
  type WorktreeOrphan,
  type WorktreeOrphanReport,
  type WorktreeOwner,
  type WorktreeRecord
} from './types.js';

export interface InMemoryWorktreeManagerOptions {
  placement: WorktreePlacement;
  idFactory?: () => WorktreeId;
  now?: () => Date;
}

function defaultIdFactory(): () => WorktreeId {
  let n = 0;
  return () => {
    n += 1;
    return `wt-${n}`;
  };
}

function ownerKey(owner: WorktreeOwner): string {
  return `${owner.kind}::${owner.id}`;
}

function intentsEqual(a: WorktreeIntent, b: WorktreeIntent): boolean {
  return (
    a.branchName === b.branchName &&
    a.suggestedPath === b.suggestedPath &&
    a.issueNumber === b.issueNumber
  );
}

function validateIssueOwnerIntent(owner: WorktreeOwner, intent: WorktreeIntent): void {
  if (owner.kind !== 'issue') {
    return;
  }
  const expected = Number(owner.id);
  if (!Number.isInteger(expected) || expected <= 0) {
    throw new WorktreeManagerError(
      'invalid-intent',
      `owner.id must be a positive integer string when owner.kind is 'issue' (got ${JSON.stringify(owner.id)})`
    );
  }
  if (intent.issueNumber !== expected) {
    throw new WorktreeManagerError(
      'invalid-intent',
      `intent.issueNumber (${intent.issueNumber ?? 'missing'}) must equal Number(owner.id) (${expected}) when owner.kind is 'issue'`
    );
  }
}

interface InternalRecord {
  record: WorktreeRecord;
  intent: WorktreeIntent;
}

export class InMemoryWorktreeManager implements WorktreeManager {
  private readonly placement: WorktreePlacement;
  private readonly idFactory: () => WorktreeId;
  private readonly now: () => Date;
  private readonly records = new Map<WorktreeId, InternalRecord>();
  private readonly ownerIndex = new Map<string, WorktreeId>();

  constructor(options: InMemoryWorktreeManagerOptions) {
    this.placement = options.placement;
    this.idFactory = options.idFactory ?? defaultIdFactory();
    this.now = options.now ?? (() => new Date());
  }

  async acquire(input: AcquireInput): Promise<WorktreeRecord> {
    const { owner, intent } = input;
    validateIssueOwnerIntent(owner, intent);

    const existingId = this.ownerIndex.get(ownerKey(owner));
    if (existingId !== undefined) {
      const existing = this.records.get(existingId);
      if (!existing) {
        // defensive: indexes diverged due to a bug elsewhere — treat as no existing record.
        this.ownerIndex.delete(ownerKey(owner));
      } else if (intentsEqual(existing.intent, intent)) {
        existing.record.lastSeenAt = input.now ?? this.now();
        return existing.record;
      } else {
        throw new WorktreeManagerError(
          'owner-already-acquired',
          `owner ${ownerKey(owner)} already holds worktree ${existingId} with a different intent`
        );
      }
    }

    let location;
    try {
      location = await this.placement.ensure(intent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorktreeManagerError('placement-failed', `placement.ensure failed: ${message}`);
    }

    const id = this.idFactory();
    const createdAt = input.now ?? this.now();
    const record: WorktreeRecord = {
      id,
      owner: { ...owner },
      location,
      issueNumber: owner.kind === 'issue' ? Number(owner.id) : intent.issueNumber ?? null,
      createdAt,
      lastSeenAt: createdAt
    };

    this.records.set(id, { record, intent: { ...intent } });
    this.ownerIndex.set(ownerKey(owner), id);
    return record;
  }

  async release(input: ReleaseInput): Promise<void> {
    const entry = this.records.get(input.id);
    if (!entry) {
      return;
    }

    if (input.deleteOnDisk === true) {
      // Bubble placement errors up unchanged; leave the record in place so the
      // caller can decide whether to retry or escalate to reap().
      await this.placement.remove(entry.record.location);
    }

    this.records.delete(input.id);
    this.ownerIndex.delete(ownerKey(entry.record.owner));
  }

  async get(id: WorktreeId): Promise<WorktreeRecord | null> {
    const entry = this.records.get(id);
    return entry ? entry.record : null;
  }

  async findByOwner(owner: WorktreeOwner): Promise<WorktreeRecord | null> {
    const id = this.ownerIndex.get(ownerKey(owner));
    if (id === undefined) {
      return null;
    }
    const entry = this.records.get(id);
    return entry ? entry.record : null;
  }

  async list(): Promise<WorktreeRecord[]> {
    return Array.from(this.records.values()).map((entry) => entry.record);
  }

  async touch(id: WorktreeId, now?: Date): Promise<void> {
    const entry = this.records.get(id);
    if (!entry) {
      return;
    }
    entry.record.lastSeenAt = now ?? this.now();
  }

  async findOrphans(now?: Date): Promise<WorktreeOrphanReport> {
    const onDisk = await this.placement.list();
    const onDiskPaths = new Set(onDisk.map((loc) => loc.path));

    const trackedPaths = new Set<string>();
    const danglingEntries: WorktreeRecord[] = [];

    for (const entry of this.records.values()) {
      trackedPaths.add(entry.record.location.path);
      if (!onDiskPaths.has(entry.record.location.path)) {
        danglingEntries.push(entry.record);
      }
    }

    danglingEntries.sort((a, b) => {
      const t = a.createdAt.getTime() - b.createdAt.getTime();
      if (t !== 0) return t;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const untrackedLocations = onDisk
      .filter((loc) => !trackedPaths.has(loc.path))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const orphans: WorktreeOrphan[] = [
      ...danglingEntries.map((record): WorktreeOrphan => ({ kind: 'dangling-record', record })),
      ...untrackedLocations.map((location): WorktreeOrphan => ({ kind: 'untracked-location', location }))
    ];

    return { orphans, scannedAt: now ?? this.now() };
  }

  async reap(orphan: WorktreeOrphan, _now?: Date): Promise<void> {
    if (orphan.kind === 'dangling-record') {
      const entry = this.records.get(orphan.record.id);
      if (!entry) {
        return;
      }
      this.records.delete(orphan.record.id);
      this.ownerIndex.delete(ownerKey(entry.record.owner));
      return;
    }

    try {
      await this.placement.remove(orphan.location);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new WorktreeManagerError('reap-failed', `placement.remove failed: ${message}`);
    }
  }
}
