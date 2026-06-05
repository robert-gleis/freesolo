import fs from 'node:fs';
import path from 'node:path';

import type Database from 'better-sqlite3';

import { StateStoreError, type BackupResult, type SafeDeleteResult } from './types.js';

function timestampSegment(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function defaultBackupPath(sourcePath: string, at: Date): string {
  return `${sourcePath}.backup-${timestampSegment(at)}.db`;
}

export function backup(
  db: Database.Database,
  sourcePath: string,
  targetPath?: string,
  at: Date = new Date()
): BackupResult {
  const resolved = targetPath ?? defaultBackupPath(sourcePath, at);

  try {
    // SQLite's VACUUM INTO produces a consistent snapshot without locking writers.
    db.prepare('VACUUM INTO ?').run(resolved);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new StateStoreError('backup-failed', `VACUUM INTO failed for ${resolved}: ${cause}`);
  }

  let bytes = 0;
  try {
    bytes = fs.statSync(resolved).size;
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new StateStoreError('backup-failed', `Backup written but stat failed for ${resolved}: ${cause}`);
  }

  return { path: resolved, bytes };
}

const SIBLINGS = ['-wal', '-shm'] as const;

function fileExists(filePath: string): boolean {
  try {
    fs.statSync(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function safeDelete(sourcePath: string, trashRoot: string): SafeDeleteResult {
  try {
    fs.mkdirSync(trashRoot, { recursive: true });

    const candidates = [sourcePath, ...SIBLINGS.map((suffix) => `${sourcePath}${suffix}`)];
    const movedFiles: string[] = [];

    for (const candidate of candidates) {
      if (!fileExists(candidate)) {
        continue;
      }
      const basename = path.basename(candidate);
      fs.renameSync(candidate, path.join(trashRoot, basename));
      movedFiles.push(basename);
    }

    return { trashDir: trashRoot, movedFiles };
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new StateStoreError('safe-delete-failed', `Failed to move ${sourcePath} into ${trashRoot}: ${cause}`);
  }
}
