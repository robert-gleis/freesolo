import { execa } from 'execa';

export interface TmuxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runTmux(args: string[]): Promise<TmuxExecResult> {
  const result = await execa('tmux', args, { reject: false });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0
  };
}

export const defaultTmuxRunnerDeps = {
  runTmux,
  now: (): Date => new Date()
};

const MAX_SESSION_SEGMENT_LENGTH = 200;

export function sanitizeSessionName(id: string): string {
  let sanitized = id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (sanitized.length > MAX_SESSION_SEGMENT_LENGTH) {
    sanitized = sanitized.slice(0, MAX_SESSION_SEGMENT_LENGTH);
  }

  return sanitized || 'runner';
}

export function sessionNameForRunnerId(id: string): string {
  return `freesolo-${sanitizeSessionName(id)}`;
}
