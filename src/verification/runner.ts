import fs from 'node:fs/promises';
import path from 'node:path';

import { execa } from 'execa';

import type {
  CheckResult,
  CheckStatus,
  RunStatus,
  VerificationConfig,
  VerificationRun
} from './types.js';

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

export interface RunPipelineDeps {
  execCheck: (
    spec: ExecCheckSpec,
    onChunk: (stream: ExecCheckChunkStream, text: string) => void,
    abortSignal: AbortSignal | undefined
  ) => Promise<ExecCheckResult>;
  now: () => Date;
}

export interface RunPipelineInput {
  config: VerificationConfig;
  configPath: string;
  repoRoot: string;
  issueNumber: number;
  runDirectory: string;
  runId: string;
  bail: boolean;
  abortSignal?: AbortSignal;
}

export const defaultRunPipelineDeps: RunPipelineDeps = {
  execCheck: async (spec, onChunk, abortSignal) => {
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
  },
  now: () => new Date()
};

function resolveCheckCwd(repoRoot: string, cwd: string | undefined): string {
  if (!cwd) {
    return repoRoot;
  }

  return path.isAbsolute(cwd) ? cwd : path.join(repoRoot, cwd);
}

function aggregateStatus(checks: CheckResult[]): RunStatus {
  return checks.every((check) => check.status === 'pass') ? 'pass' : 'fail';
}

export async function runVerificationPipeline(
  input: RunPipelineInput,
  deps: RunPipelineDeps = defaultRunPipelineDeps
): Promise<VerificationRun> {
  await fs.mkdir(input.runDirectory, { recursive: true });

  const runStartedAt = deps.now().toISOString();
  const results: CheckResult[] = [];
  let bailed = false;

  const buildRun = (): VerificationRun => ({
    schemaVersion: 1 as const,
    runId: input.runId,
    issueNumber: input.issueNumber,
    repoRoot: input.repoRoot,
    configPath: input.configPath,
    startedAt: runStartedAt,
    finishedAt: deps.now().toISOString(),
    status: aggregateStatus(results),
    bail: input.bail,
    checks: results
  });

  try {
    for (const check of input.config.verification.checks) {
      const cwd = resolveCheckCwd(input.repoRoot, check.cwd);
      const logPath = path.join(input.runDirectory, `${check.name}.log`);

      if (bailed || input.abortSignal?.aborted) {
        const skippedAt = deps.now().toISOString();
        results.push({
          name: check.name,
          command: check.command,
          args: check.args,
          cwd,
          status: 'skipped',
          exitCode: null,
          signal: null,
          startedAt: skippedAt,
          finishedAt: skippedAt,
          durationMs: 0,
          logPath
        });
        continue;
      }

      const startedAt = deps.now();
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

        const exec = await deps.execCheck(
          {
            command: check.command,
            args: check.args,
            cwd,
            env: check.env
          },
          onChunk,
          input.abortSignal
        );
        flushTail('stdout');
        flushTail('stderr');
        await writeQueue;

        const finishedAt = deps.now();
        const status: CheckStatus = exec.exitCode === 0 ? 'pass' : 'fail';

        results.push({
          name: check.name,
          command: check.command,
          args: check.args,
          cwd,
          status,
          exitCode: exec.exitCode,
          signal: exec.signal,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          logPath
        });

        if (status === 'fail' && input.bail) {
          bailed = true;
        }
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

        const finishedAt = deps.now();
        results.push({
          name: check.name,
          command: check.command,
          args: check.args,
          cwd,
          status: 'fail',
          exitCode: null,
          signal: null,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          logPath
        });

        if (input.bail) {
          bailed = true;
        }
      } finally {
        if (handle) {
          await handle.close().catch(() => {});
        }
      }
    }
  } finally {
    const finalRun = buildRun();
    await fs.writeFile(
      path.join(input.runDirectory, 'run.json'),
      JSON.stringify(finalRun, null, 2)
    );
  }

  return buildRun();
}
