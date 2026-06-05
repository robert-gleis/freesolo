import path from 'node:path';

import type { WorktreeEntry } from '../core/types.js';
import type { WorktreeRecord } from './store.js';

export interface WorktreeDriftEntry {
  path: string;
  branch: string;
}

export interface WorktreeDriftReport {
  onDiskOnly: WorktreeDriftEntry[];
  metadataOnly: WorktreeRecord[];
}

function normalizePath(worktreePath: string): string {
  return path.resolve(worktreePath);
}

export function loadDriftCandidates(
  allRows: WorktreeRecord[],
  gitPaths: Set<string>,
  pathExists: (worktreePath: string) => boolean
): WorktreeRecord[] {
  const normalizedGitPaths = new Set([...gitPaths].map(normalizePath));

  return allRows.filter((row) => {
    const normalizedPath = normalizePath(row.path);
    return normalizedGitPaths.has(normalizedPath) || !pathExists(normalizedPath);
  });
}

export function detectWorktreeDrift(
  gitEntries: WorktreeEntry[],
  dbRows: WorktreeRecord[],
  pathExists: (worktreePath: string) => boolean = () => true
): WorktreeDriftReport {
  const dbByPath = new Map(dbRows.map((row) => [normalizePath(row.path), row]));
  const gitPaths = new Set<string>();

  const onDiskOnly: WorktreeDriftEntry[] = [];

  for (const entry of gitEntries) {
    const normalizedPath = normalizePath(entry.worktreePath);
    gitPaths.add(normalizedPath);

    if (!dbByPath.has(normalizedPath)) {
      onDiskOnly.push({
        path: normalizedPath,
        branch: entry.branchName
      });
    }
  }

  const metadataOnly = dbRows.filter((row) => {
    const normalizedPath = normalizePath(row.path);
    return !gitPaths.has(normalizedPath) && !pathExists(normalizedPath);
  });

  return { onDiskOnly, metadataOnly };
}
