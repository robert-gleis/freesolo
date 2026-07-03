import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type { CheckStatus } from './types.js';

export interface ExecCheckSpec {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface ExecCheckResult {
  exitCode: number | null;
  signal: string | null;
}

export type ExecCheckChunkStream = 'stdout' | 'stderr';

export type ExecCheck = (
  spec: ExecCheckSpec,
  onChunk: (stream: ExecCheckChunkStream, text: string) => void,
  abortSignal: AbortSignal | undefined
) => Promise<ExecCheckResult>;

/**
 * Real subprocess exec used by the Gate Route shell checks. Streams stdout and
 * stderr chunks to `onChunk`, never rejects (spawn failures surface as
 * `exitCode: null` plus a message chunk), and forwards SIGINT on abort.
 */
export const defaultExecCheck: ExecCheck = async (spec, onChunk, abortSignal) => {
  try {
    const subprocess = execa(spec.command, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      reject: false,
      buffer: false,
      stdout: 'pipe',
      stderr: 'pipe'
    });

    subprocess.stdout?.on('data', (chunk: Buffer) => onChunk('stdout', chunk.toString('utf8')));
    subprocess.stderr?.on('data', (chunk: Buffer) => onChunk('stderr', chunk.toString('utf8')));
    subprocess.stdout?.on('error', (err) => onChunk('stderr', `[runner] stdout error: ${err.message}\n`));
    subprocess.stderr?.on('error', (err) => onChunk('stderr', `[runner] stderr error: ${err.message}\n`));

    const onAbort = abortSignal
      ? () => {
          try {
            subprocess.kill('SIGINT');
          } catch {
            // subprocess may already have exited
          }
        }
      : null;
    if (abortSignal && onAbort) {
      if (abortSignal.aborted) {
        try {
          subprocess.kill('SIGINT');
        } catch {
          // subprocess may already have exited
        }
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      const result = (await subprocess) as {
        exitCode?: number | null;
        signal?: string | null;
        failed?: boolean;
        shortMessage?: string;
        originalMessage?: string;
        code?: string;
      };

      // execa 9 with `reject: false` does NOT throw on spawn failures
      // (ENOENT, EACCES, etc.). Instead it resolves with `failed: true` and
      // an empty exitCode. Surface the failure message via onChunk so the
      // log contains a useful explanation rather than being empty.
      if (result.failed && (result.exitCode === null || result.exitCode === undefined)) {
        const failureMessage = result.shortMessage ?? result.originalMessage ?? result.code ?? 'spawn failed';
        onChunk('stderr', `${failureMessage}\n`);
      }

      return {
        exitCode: typeof result.exitCode === 'number' ? result.exitCode : null,
        signal: typeof result.signal === 'string' ? result.signal : null
      };
    } finally {
      if (abortSignal && onAbort) {
        abortSignal.removeEventListener('abort', onAbort);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onChunk('stderr', `${message}\n`);
    const execaError = error as { exitCode?: number | null; signal?: string | null };
    return {
      exitCode: typeof execaError.exitCode === 'number' ? execaError.exitCode : null,
      signal: typeof execaError.signal === 'string' ? execaError.signal : null
    };
  }
};

export function resolveCheckCwd(repoRoot: string, cwd: string | undefined): string {
  if (!cwd) {
    return repoRoot;
  }

  return path.isAbsolute(cwd) ? cwd : path.join(repoRoot, cwd);
}

export interface ShellCheckOutcome {
  status: CheckStatus;
  exitCode: number | null;
  signal: string | null;
}

/**
 * Runs a single shell check: streams the subprocess output into `logPath`
 * (line-prefixed with [stdout]/[stderr]) and returns pass/fail. Non-zero exit,
 * a spawn failure, or a signal all count as `fail`. This is the shared exec +
 * log-streaming helper reused by the Gate Route runner — do not reimplement it.
 */
export async function runShellCheck(
  spec: ExecCheckSpec,
  logPath: string,
  execCheck: ExecCheck,
  abortSignal: AbortSignal | undefined
): Promise<ShellCheckOutcome> {
  let handle: fs.FileHandle | null = null;
  let writeQueue: Promise<unknown> = Promise.resolve();

  try {
    handle = await fs.open(logPath, 'w');
    const tails: { stdout: string; stderr: string } = { stdout: '', stderr: '' };

    const queueWrite = (payload: string) => {
      writeQueue = writeQueue.then(() => handle!.write(payload));
    };

    const flushTail = (stream: 'stdout' | 'stderr') => {
      if (tails[stream].length > 0) {
        const prefix = stream === 'stdout' ? '[stdout] ' : '[stderr] ';
        queueWrite(`${prefix}${tails[stream]}\n`);
        tails[stream] = '';
      }
    };

    const onChunk = (stream: 'stdout' | 'stderr', text: string) => {
      const combined = tails[stream] + text;
      const lines = combined.split('\n');
      tails[stream] = lines.pop() ?? '';
      const prefix = stream === 'stdout' ? '[stdout] ' : '[stderr] ';
      if (lines.length > 0) {
        const payload = lines.map((line) => `${prefix}${line}\n`).join('');
        queueWrite(payload);
      }
    };

    const exec = await execCheck(spec, onChunk, abortSignal);
    flushTail('stdout');
    flushTail('stderr');
    await writeQueue;

    return {
      status: exec.exitCode === 0 ? 'pass' : 'fail',
      exitCode: exec.exitCode,
      signal: exec.signal
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await writeQueue;
    } catch {
      // pre-throw chunks may themselves have failed; ignore
    }
    if (handle) {
      try {
        await handle.write(`[stderr] ${message}\n`);
      } catch {
        // handle may already be closed or unwritable — swallow
      }
    }

    return { status: 'fail', exitCode: null, signal: null };
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
    }
  }
}
