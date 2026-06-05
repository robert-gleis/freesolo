export type WorktreeId = string;

export type WorktreeOwnerKind = 'agent' | 'team' | 'issue';

export interface WorktreeOwner {
  kind: WorktreeOwnerKind;
  id: string;
}

export interface WorktreeIntent {
  branchName: string;
  suggestedPath?: string;
  issueNumber?: number;
}

export interface WorktreeLocation {
  path: string;
  branchName: string;
}

export interface WorktreeRecord {
  id: WorktreeId;
  owner: WorktreeOwner;
  location: WorktreeLocation;
  issueNumber: number | null;
  createdAt: Date;
  lastSeenAt: Date;
}

export type WorktreeOrphanKind = 'dangling-record' | 'untracked-location';

export type WorktreeOrphan =
  | { kind: 'dangling-record'; record: WorktreeRecord }
  | { kind: 'untracked-location'; location: WorktreeLocation };

export interface WorktreeOrphanReport {
  orphans: WorktreeOrphan[];
  scannedAt: Date;
}

export type WorktreeManagerErrorCode =
  | 'owner-already-acquired'
  | 'placement-failed'
  | 'reap-failed'
  | 'invalid-intent';

export class WorktreeManagerError extends Error {
  readonly code: WorktreeManagerErrorCode;

  constructor(code: WorktreeManagerErrorCode, message: string) {
    super(message);
    this.name = 'WorktreeManagerError';
    this.code = code;
  }
}
