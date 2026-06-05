import { execa } from 'execa';

import { buildCombined } from './log-format.js';
import {
  RunnerError,
  type LogOptions,
  type LogSnapshot,
  type Runner,
  type RunnerId,
  type RunnerState,
  type RunnerStatus,
  type SpawnSpec
} from './types.js';

export interface LocalProcessRunnerOptions {
  maxLogBytes?: number;
  stopGraceMs?: number;
}

export type SpawnProcessResult = {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill: (signal?: NodeJS.Signals) => void;
  exited: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
};

export type SpawnProcess = (spec: SpawnSpec) => SpawnProcessResult;

export interface LocalProcessRunnerDeps {
  spawnProcess?: SpawnProcess;
}

const DEFAULT_MAX_LOG_BYTES = 1_048_576;
const DEFAULT_STOP_GRACE_MS = 5_000;

function resolveExitCode(exitCode: number | null, signal: NodeJS.Signals | null): number {
  if (exitCode !== null) return exitCode;
  if (signal) return 128;
  return 0;
}

function totalLogBytes(stdout: string, stderr: string): number {
  return Buffer.byteLength(stdout, 'utf8') + Buffer.byteLength(stderr, 'utf8');
}

function trimLogsToCap(
  buffers: { stdout: string; stderr: string },
  maxLogBytes: number
): void {
  while (totalLogBytes(buffers.stdout, buffers.stderr) > maxLogBytes) {
    if (buffers.stdout.length > 0) {
      buffers.stdout = buffers.stdout.slice(1);
      continue;
    }
    if (buffers.stderr.length > 0) {
      buffers.stderr = buffers.stderr.slice(1);
      continue;
    }
    break;
  }
}

export class LocalProcessRunner implements Runner {
  readonly id: RunnerId;

  private readonly maxLogBytes: number;
  private readonly stopGraceMs: number;
  private readonly spawnProcess: SpawnProcess;

  private state: RunnerState = 'idle';
  private startedAt?: Date;
  private stoppedAt?: Date;
  private exitCode?: number;
  private errorMessage?: string;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private logTruncated = false;
  private child: SpawnProcessResult | null = null;
  private stopInProgress = false;

  constructor(
    id: RunnerId,
    options?: LocalProcessRunnerOptions,
    deps?: LocalProcessRunnerDeps
  ) {
    this.id = id;
    this.maxLogBytes = options?.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
    this.stopGraceMs = options?.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    this.spawnProcess = deps?.spawnProcess ?? defaultSpawnProcess;
  }

  async spawn(spec: SpawnSpec): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new RunnerError(
        'invalid-state',
        `Cannot spawn from state "${this.state}"`
      );
    }

    this.state = 'starting';
    this.startedAt = new Date();
    this.stoppedAt = undefined;
    this.exitCode = undefined;
    this.errorMessage = undefined;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.logTruncated = false;
    this.child = null;
    this.stopInProgress = false;

    try {
      const child = this.spawnProcess(spec);
      this.child = child;
      this.wireStream(child.stdout, 'stdout');
      this.wireStream(child.stderr, 'stderr');
      void this.watchExit(child);

      const earlyExit = await Promise.race([
        child.exited.catch((error: Error) => {
          throw error;
        }),
        new Promise<null>((resolve) => {
          setImmediate(() => resolve(null));
        })
      ]);

      if (earlyExit !== null && this.state === 'starting') {
        this.exitCode = resolveExitCode(earlyExit.exitCode, earlyExit.signal);
        this.stoppedAt = new Date();
        this.state = 'stopped';
        this.child = null;
        return;
      }

      if (this.state === 'starting') {
        this.state = 'running';
      }
    } catch (error) {
      if (error instanceof RunnerError) throw error;
      this.state = 'error';
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage = message;
      throw new RunnerError('spawn-failed', message);
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    const priorError = this.errorMessage;
    this.stopInProgress = true;
    this.state = 'stopping';

    const child = this.child;
    if (!child) {
      this.finalizeStop(0, priorError);
      return;
    }

    try {
      child.kill('SIGTERM');
      let exited = await Promise.race([
        child.exited,
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), this.stopGraceMs);
        })
      ]);

      if (exited === null) {
        child.kill('SIGKILL');
        exited = await child.exited;
      }

      this.exitCode = resolveExitCode(exited.exitCode, exited.signal);
    } catch (error) {
      if (priorError) {
        this.finalizeStop(this.exitCode ?? 1, priorError);
        return;
      }

      this.state = 'error';
      const message = error instanceof Error ? error.message : String(error);
      this.errorMessage = message;
      throw new RunnerError('stop-failed', message);
    }

    this.finalizeStop(this.exitCode ?? 0, priorError);
  }

  async logs(_options?: LogOptions): Promise<LogSnapshot> {
    const stdout = this.stdoutBuffer;
    const stderr = this.stderrBuffer;
    return {
      stdout,
      stderr,
      combined: buildCombined(stdout, stderr),
      truncated: this.logTruncated
    };
  }

  async status(): Promise<RunnerStatus> {
    const snapshot: RunnerStatus = { state: this.state };
    if (this.startedAt) snapshot.startedAt = this.startedAt;
    if (this.stoppedAt) snapshot.stoppedAt = this.stoppedAt;
    if (this.exitCode !== undefined) snapshot.exitCode = this.exitCode;
    if (this.errorMessage) snapshot.error = this.errorMessage;
    return snapshot;
  }

  private wireStream(stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr'): void {
    if (!stream) return;

    stream.on('data', (chunk: Buffer) => {
      if (kind === 'stdout') {
        this.stdoutBuffer += chunk.toString('utf8');
      } else {
        this.stderrBuffer += chunk.toString('utf8');
      }

      if (totalLogBytes(this.stdoutBuffer, this.stderrBuffer) > this.maxLogBytes) {
        this.logTruncated = true;
        const buffers = { stdout: this.stdoutBuffer, stderr: this.stderrBuffer };
        trimLogsToCap(buffers, this.maxLogBytes);
        this.stdoutBuffer = buffers.stdout;
        this.stderrBuffer = buffers.stderr;
      }
    });
  }

  private async watchExit(child: SpawnProcessResult): Promise<void> {
    try {
      const { exitCode, signal } = await child.exited;
      if (this.stopInProgress) return;

      this.exitCode = resolveExitCode(exitCode, signal);
      this.stoppedAt = new Date();
      this.state = 'stopped';
      this.child = null;
    } catch {
      if (this.stopInProgress) return;
      this.state = 'error';
    }
  }

  private finalizeStop(exitCode: number, priorError?: string): void {
    this.state = 'stopped';
    this.stoppedAt = new Date();
    this.exitCode = exitCode;
    if (priorError) this.errorMessage = priorError;
    this.child = null;
    this.stopInProgress = false;
  }
}

function defaultSpawnProcess(spec: SpawnSpec): SpawnProcessResult {
  const child = execa(spec.binary, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    reject: false,
    cleanup: false,
    forceKillAfterDelay: false
  });

  const exited = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.on('error', (error: Error) => {
        reject(error);
      });
      void child.then((result) => {
        resolve({
          exitCode: result.exitCode ?? null,
          signal: (result.signal as NodeJS.Signals | undefined) ?? null
        });
      });
    }
  );

  return {
    stdout: child.stdout,
    stderr: child.stderr,
    kill: (signal) => {
      child.kill(signal);
    },
    exited
  };
}
