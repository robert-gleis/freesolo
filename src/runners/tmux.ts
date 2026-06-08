import {
  defaultTmuxRunnerDeps,
  sessionNameForRunnerId,
  type TmuxExecResult
} from './tmux-command.js';
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

export interface TmuxRunnerDeps {
  runTmux: (args: string[]) => Promise<TmuxExecResult>;
  now?: () => Date;
}

const SPAWN_POLL_INTERVAL_MS = 50;
const SPAWN_POLL_TIMEOUT_MS = 2000;

export class TmuxRunner implements Runner {
  readonly id: RunnerId;

  private readonly deps: Required<Pick<TmuxRunnerDeps, 'runTmux'>> & { now: () => Date };
  private readonly sessionName: string;

  private state: RunnerState = 'idle';
  private startedAt?: Date;
  private stoppedAt?: Date;
  private exitCode?: number;
  private errorMessage?: string;
  private hasSpawned = false;
  private logCache = '';

  constructor(id: RunnerId, deps?: TmuxRunnerDeps) {
    this.id = id;
    const merged = { ...defaultTmuxRunnerDeps, ...deps };
    this.deps = {
      runTmux: merged.runTmux,
      now: merged.now
    };
    this.sessionName = sessionNameForRunnerId(id);
  }

  async spawn(spec: SpawnSpec): Promise<void> {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new RunnerError(
        'invalid-state',
        `Cannot spawn from state "${this.state}"`
      );
    }

    this.state = 'starting';
    this.startedAt = this.deps.now();
    this.stoppedAt = undefined;
    this.exitCode = undefined;
    this.errorMessage = undefined;
    this.logCache = '';

    try {
      const version = await this.deps.runTmux(['-V']);
      if (version.exitCode !== 0) {
        throw new RunnerError('spawn-failed', 'tmux is not available');
      }

      const existing = await this.deps.runTmux(['has-session', '-t', this.sessionName]);
      if (existing.exitCode === 0) {
        await this.deps.runTmux(['kill-session', '-t', this.sessionName]);
      }

      const created = await this.deps.runTmux([
        'new-session',
        '-d',
        '-s',
        this.sessionName,
        '-c',
        spec.cwd
      ]);
      if (created.exitCode !== 0) {
        throw new RunnerError('spawn-failed', `tmux new-session failed: ${created.stderr}`);
      }

      for (const [key, value] of Object.entries(spec.env ?? {})) {
        if (value === '') continue;
        await this.deps.runTmux(['set-environment', '-t', this.sessionName, key, value]);
      }

      const sendKeysArgs = [
        'send-keys',
        '-t',
        this.sessionName,
        '--',
        spec.binary,
        ...spec.args,
        'Enter'
      ];
      await this.deps.runTmux(sendKeysArgs);

      const alive = await this.pollUntilRunning();
      if (!alive) {
        await this.deps.runTmux(['kill-session', '-t', this.sessionName]);
        throw new RunnerError('spawn-failed', 'tmux session did not become ready in time');
      }

      if (this.state === 'starting') {
        this.state = 'running';
        this.hasSpawned = true;
      }
    } catch (error) {
      if (error instanceof RunnerError) {
        this.state = 'error';
        this.errorMessage = error.message;
        throw error;
      }
      this.state = 'error';
      this.errorMessage = error instanceof Error ? error.message : String(error);
      throw new RunnerError('spawn-failed', this.errorMessage);
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'stopped') {
      return;
    }

    const priorError = this.errorMessage;
    this.state = 'stopping';

    const exitCode = await this.readPaneExitStatus();

    const killed = await this.deps.runTmux(['kill-session', '-t', this.sessionName]);
    if (killed.exitCode !== 0 && killed.stderr && !killed.stderr.includes("can't find session")) {
      this.state = 'error';
      this.errorMessage = killed.stderr || 'tmux kill-session failed';
      throw new RunnerError('stop-failed', this.errorMessage);
    }

    this.state = 'stopped';
    this.stoppedAt = this.deps.now();
    this.exitCode = exitCode ?? 0;
    if (priorError) {
      this.errorMessage = priorError;
    }
  }

  async logs(options?: LogOptions): Promise<LogSnapshot> {
    if (!this.hasSpawned) {
      return { stdout: '', stderr: '', combined: '', truncated: false };
    }

    if (this.state === 'running' || this.state === 'starting') {
      const captured = await this.capturePane();
      if (captured !== null) {
        this.logCache = captured;
      }
    }

    let stdout = this.logCache;
    if (options?.sinceByteOffset !== undefined && options.sinceByteOffset > 0) {
      stdout = stdout.slice(options.sinceByteOffset);
    }

    return {
      stdout,
      stderr: '',
      combined: buildCombined(stdout, ''),
      truncated: false
    };
  }

  async status(): Promise<RunnerStatus> {
    if (this.state === 'running') {
      const dead = await this.isPaneDead();
      if (dead) {
        const exitCode = (await this.readPaneExitStatus()) ?? 1;
        this.state = 'stopped';
        this.stoppedAt = this.deps.now();
        this.exitCode = exitCode;
      }
    }

    const snapshot: RunnerStatus = { state: this.state };
    if (this.startedAt) snapshot.startedAt = this.startedAt;
    if (this.stoppedAt) snapshot.stoppedAt = this.stoppedAt;
    if (this.exitCode !== undefined) snapshot.exitCode = this.exitCode;
    if (this.errorMessage) snapshot.error = this.errorMessage;
    return snapshot;
  }

  private async pollUntilRunning(): Promise<boolean> {
    const deadline = Date.now() + SPAWN_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const session = await this.deps.runTmux(['has-session', '-t', this.sessionName]);
      if (session.exitCode !== 0) {
        await sleep(SPAWN_POLL_INTERVAL_MS);
        continue;
      }
      const dead = await this.isPaneDead();
      if (!dead) {
        return true;
      }
      await sleep(SPAWN_POLL_INTERVAL_MS);
    }
    return false;
  }

  private async isPaneDead(): Promise<boolean> {
    const session = await this.deps.runTmux(['has-session', '-t', this.sessionName]);
    if (session.exitCode !== 0) {
      return true;
    }
    const panes = await this.deps.runTmux([
      'list-panes',
      '-t',
      this.sessionName,
      '-F',
      '#{pane_dead}'
    ]);
    const firstLine = panes.stdout.trim().split('\n')[0];
    return firstLine === '1';
  }

  private async readPaneExitStatus(): Promise<number | undefined> {
    const session = await this.deps.runTmux(['has-session', '-t', this.sessionName]);
    if (session.exitCode !== 0) {
      return undefined;
    }
    const panes = await this.deps.runTmux([
      'list-panes',
      '-t',
      this.sessionName,
      '-F',
      '#{pane_exit_status}'
    ]);
    const raw = panes.stdout.trim().split('\n')[0];
    if (raw === '' || raw === '0') {
      return raw === '' ? undefined : 0;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }

  private async capturePane(): Promise<string | null> {
    const session = await this.deps.runTmux(['has-session', '-t', this.sessionName]);
    if (session.exitCode !== 0) {
      return null;
    }
    const captured = await this.deps.runTmux([
      'capture-pane',
      '-p',
      '-t',
      this.sessionName,
      '-S',
      '-'
    ]);
    if (captured.exitCode !== 0) {
      return null;
    }
    return captured.stdout;
  }
}

function buildCombined(stdout: string, stderr: string): string {
  const parts: string[] = [];
  if (stdout.length > 0) parts.push(`[stdout]\n${stdout}`);
  if (stderr.length > 0) parts.push(`[stderr]\n${stderr}`);
  return parts.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
