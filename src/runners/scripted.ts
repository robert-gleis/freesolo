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

export interface ScriptedRunnerScript {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  spawnDelayMs?: number;
  failOnSpawn?: string;
}

export class ScriptedRunner implements Runner {
  readonly id: RunnerId;

  private state: RunnerState = 'idle';
  private startedAt?: Date;
  private stoppedAt?: Date;
  private exitCode?: number;
  private errorMessage?: string;
  private hasSpawned = false;
  private readonly script: ScriptedRunnerScript;

  constructor(id: RunnerId, script: ScriptedRunnerScript = {}) {
    this.id = id;
    this.script = script;
  }

  async spawn(_spec: SpawnSpec): Promise<void> {
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

    if (this.script.failOnSpawn !== undefined) {
      this.state = 'error';
      this.errorMessage = this.script.failOnSpawn;
      throw new RunnerError('spawn-failed', this.script.failOnSpawn);
    }

    const delay = this.script.spawnDelayMs ?? 0;
    if (delay > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delay);
      });
    }

    // If stop() ran while we were awaiting the spawn delay, the runner is
    // already in `stopping` or `stopped`; do not clobber that.
    if (this.state === 'starting') {
      this.state = 'running';
      this.hasSpawned = true;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    this.state = 'stopping';
    this.state = 'stopped';
    this.stoppedAt = new Date();
    this.exitCode = this.script.exitCode ?? 0;
  }

  async logs(_options?: LogOptions): Promise<LogSnapshot> {
    if (!this.hasSpawned) {
      return { stdout: '', stderr: '', combined: '', truncated: false };
    }

    const stdout = this.script.stdout ?? '';
    const stderr = this.script.stderr ?? '';
    return {
      stdout,
      stderr,
      combined: buildCombined(stdout, stderr),
      truncated: false
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
}
