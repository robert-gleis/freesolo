import path from 'node:path';

import { issueflowHome } from '../core/paths.js';

function homeDir(): string {
  return issueflowHome();
}

function timestampSegment(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function resolveDefaultPath(): string {
  return path.join(homeDir(), 'state.db');
}

export function resolveTrashDir(at: Date = new Date()): string {
  return path.join(homeDir(), 'trash', timestampSegment(at));
}
