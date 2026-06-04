import os from 'node:os';
import path from 'node:path';

function homeDir(): string {
  return process.env.ISSUEFLOW_HOME ?? path.join(os.homedir(), '.issueflow');
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
