import { spawn, type ChildProcess } from 'node:child_process';

export interface PiSpawnOptions {
  binary: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface PiTransport {
  spawn(options: PiSpawnOptions): Promise<void>;
  writeLine(line: string): void;
  kill(): Promise<void>;
  onStdoutLine(handler: (line: string) => void): void;
  onStderr(handler: (chunk: string) => void): void;
  onClose(handler: (code: number | null) => void): void;
  getSpawnCapture(): PiSpawnOptions | undefined;
}

type PiJson = Record<string, unknown>;

export function splitJsonlLines(buffer: string): { lines: string[]; remainder: string } {
  const lines: string[] = [];
  let start = 0;

  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== '\n') continue;
    let end = index;
    if (end > start && buffer[end - 1] === '\r') {
      end -= 1;
    }
    const line = buffer.slice(start, end);
    if (line.length > 0) {
      lines.push(line);
    }
    start = index + 1;
  }

  return { lines, remainder: buffer.slice(start) };
}

export function parsePiLine(line: string): PiJson | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as PiJson;
}

function buildPiCommandLine(command: PiJson): string {
  return `${JSON.stringify(command)}\n`;
}

const DIALOG_UI_METHODS = new Set(['select', 'confirm', 'input', 'editor']);

function isDialogUiRequest(event: PiJson): boolean {
  return (
    event.type === 'extension_ui_request' &&
    typeof event.method === 'string' &&
    DIALOG_UI_METHODS.has(event.method)
  );
}

export class PiRpcSession {
  private readonly transport: PiTransport;
  private stdoutRemainder = '';
  private pendingPrompt: Promise<void> | null = null;
  private idle = true;
  private readonly lineListeners = new Set<(event: PiJson) => void>();

  constructor(transport: PiTransport) {
    this.transport = transport;
  }

  isIdle(): boolean {
    return this.idle && this.pendingPrompt === null;
  }

  async prompt(message: string): Promise<void> {
    if (this.pendingPrompt) {
      await this.pendingPrompt;
    }

    this.idle = false;
    const id = `prompt-${Date.now()}`;

    await new Promise<void>((resolve, reject) => {
      const onLine = (event: PiJson): void => {
        if (event.type === 'response' && event.command === 'prompt') {
          if (event.id !== undefined && event.id !== id) return;
          if (!event.success) {
            cleanup();
            reject(new Error(`prompt rejected: ${String(event.error ?? 'unknown')}`));
            return;
          }
        }

        if (event.type === 'agent_end') {
          cleanup();
          resolve();
        }
      };

      const cleanup = (): void => {
        this.pendingPrompt = null;
        this.idle = true;
        this.lineListeners.delete(onLine);
      };

      this.pendingPrompt = Promise.resolve();
      this.lineListeners.add(onLine);
      this.transport.writeLine(buildPiCommandLine({ id, type: 'prompt', message }));
    });
  }

  async getLastAssistantText(): Promise<string> {
    const id = `get-text-${Date.now()}`;

    return new Promise<string>((resolve, reject) => {
      const onLine = (event: PiJson): void => {
        if (event.type !== 'response' || event.command !== 'get_last_assistant_text') {
          return;
        }
        if (event.id !== undefined && event.id !== id) return;

        this.lineListeners.delete(onLine);

        if (!event.success) {
          reject(new Error('get_last_assistant_text failed'));
          return;
        }

        const data = event.data as { text?: string | null } | undefined;
        resolve(data?.text ?? '');
      };

      this.lineListeners.add(onLine);
      this.transport.writeLine(
        buildPiCommandLine({ id, type: 'get_last_assistant_text' })
      );
    });
  }

  async abort(): Promise<void> {
    this.transport.writeLine(buildPiCommandLine({ type: 'abort' }));
  }

  feedStdout(chunk: string): void {
    this.stdoutRemainder += chunk;
    const split = splitJsonlLines(this.stdoutRemainder);
    this.stdoutRemainder = split.remainder;
    for (const line of split.lines) {
      this.handleStdoutLine(line);
    }
  }

  private handleStdoutLine(line: string): void {
    const parsed = parsePiLine(line);
    if (!parsed) return;

    if (isDialogUiRequest(parsed) && typeof parsed.id === 'string') {
      this.transport.writeLine(
        buildPiCommandLine({
          type: 'extension_ui_response',
          id: parsed.id,
          cancelled: true
        })
      );
      return;
    }

    for (const listener of this.lineListeners) {
      listener(parsed);
    }
  }
}

export type InMemoryPiCommandHandler = (
  command: PiJson,
  emit: (event: PiJson) => void
) => void;

export interface InMemoryPiTransportOptions {
  onCommand?: InMemoryPiCommandHandler;
  onWrite?: (line: string) => void;
  spawnDelayMs?: number;
}

export interface InMemoryPiTransport extends PiTransport {
  pushStdoutLine(line: string): void;
  emitStderr(chunk: string): void;
  emitClose(code: number): void;
}

export function createInMemoryPiTransport(
  options: InMemoryPiTransportOptions = {}
): InMemoryPiTransport {
  let spawnCapture: PiSpawnOptions | undefined;
  let stdoutHandler: ((line: string) => void) | undefined;
  let stderrHandler: ((chunk: string) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const emitStdoutLine = (line: string): void => {
    stdoutHandler?.(line);
  };

  const transport: InMemoryPiTransport = {
    async spawn(capture) {
      spawnCapture = capture;
      const delay = options.spawnDelayMs ?? 0;
      if (delay > 0) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });
      }
    },
    writeLine(line) {
      options.onWrite?.(line);
      const command = parsePiLine(line.trim());
      if (!command) return;

      options.onCommand?.(command, (event) => {
        emitStdoutLine(JSON.stringify(event));
      });
    },
    async kill() {
      closeHandler?.(0);
    },
    onStdoutLine(handler) {
      stdoutHandler = handler;
    },
    onStderr(handler) {
      stderrHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    getSpawnCapture: () => spawnCapture,
    pushStdoutLine(line: string) {
      emitStdoutLine(line);
    },
    emitStderr(chunk: string) {
      stderrHandler?.(chunk);
    },
    emitClose(code: number) {
      closeHandler?.(code);
    }
  };

  return transport;
}

export function createNodePiTransport(): PiTransport {
  let child: ChildProcess | undefined;
  let stdoutRemainder = '';
  let spawnCapture: PiSpawnOptions | undefined;
  let stdoutHandler: ((line: string) => void) | undefined;
  let stderrHandler: ((chunk: string) => void) | undefined;
  let closeHandler: ((code: number | null) => void) | undefined;

  const flushStdout = (chunk: string): void => {
    stdoutRemainder += chunk;
    const split = splitJsonlLines(stdoutRemainder);
    stdoutRemainder = split.remainder;
    for (const line of split.lines) {
      stdoutHandler?.(line);
    }
  };

  return {
    async spawn(options) {
      spawnCapture = options;

      await new Promise<void>((resolve, reject) => {
        child = spawn(options.binary, options.args, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        child.once('error', (error) => {
          child = undefined;
          reject(error);
        });

        child.stdout?.on('data', (data: Buffer) => {
          flushStdout(data.toString('utf8'));
        });
        child.stderr?.on('data', (data: Buffer) => {
          stderrHandler?.(data.toString('utf8'));
        });
        child.on('close', (code) => {
          closeHandler?.(code);
          child = undefined;
        });

        // spawn is synchronous when the binary exists; next tick confirms no immediate error
        process.nextTick(() => {
          if (child) resolve();
        });
      });
    },
    writeLine(line) {
      child?.stdin?.write(line);
    },
    async kill() {
      if (!child || child.killed) return;
      const proc = child;
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (!proc.killed) {
            proc.kill('SIGKILL');
          }
          resolve();
        }, 2000);
        proc.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
    onStdoutLine(handler) {
      stdoutHandler = handler;
    },
    onStderr(handler) {
      stderrHandler = handler;
    },
    onClose(handler) {
      closeHandler = handler;
    },
    getSpawnCapture: () => spawnCapture
  };
}
