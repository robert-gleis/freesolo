import { InvalidArgumentError } from 'commander';

export type WriteChannel = 'stdout' | 'stderr';

export const defaultWrite = (channel: WriteChannel, message: string): void => {
  if (channel === 'stdout') {
    process.stdout.write(message);
  } else {
    process.stderr.write(message);
  }
};

export const defaultSetExitCode = (code: number): void => {
  process.exitCode = code;
};

export function parseIssueNumber(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== value.trim()) {
    throw new InvalidArgumentError('Issue number must be a positive integer');
  }
  return parsed;
}
