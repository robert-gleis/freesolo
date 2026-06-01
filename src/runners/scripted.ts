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

    this.state = 'running';
    this.hasSpawned = true;
  }

  async stop(): Promise<void> {
    throw new RunnerError('stop-failed', 'not implemented yet');
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

function buildCombined(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) parts.push(`[stdout]\n${stdout}`);
  if (stderr.length > 0) parts.push(`[stderr]\n${stderr}`);
  return parts.join('\n');
}
