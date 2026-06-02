import { describe, expect, it } from 'vitest';

import { PiAgentAdapter, createInMemoryPiTransport } from '../../src/agents/pi.js';
import type { AgentState } from '../../src/agents/types.js';

function defaultPiHandler(
  command: Record<string, unknown>,
  emit: (event: Record<string, unknown>) => void
): void {
  if (command.type === 'prompt') {
    emit({ type: 'response', command: 'prompt', success: true, id: command.id });
    emit({ type: 'agent_end', messages: [] });
  }
  if (command.type === 'get_last_assistant_text') {
    emit({
      type: 'response',
      command: 'get_last_assistant_text',
      success: true,
      id: command.id,
      data: { text: 'done' }
    });
  }
}

describe('PiAgentAdapter', () => {
  it('reports idle before start', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport()
    });
    expect((await adapter.status()).state).toBe('idle');
  });

  it('start spawns pi with full rpc argv', async () => {
    let capture: { args: string[]; cwd: string } | undefined;
    const adapter = new PiAgentAdapter({
      transportFactory: () => {
        const transport = createInMemoryPiTransport({
          onCommand: defaultPiHandler
        });
        const originalSpawn = transport.spawn.bind(transport);
        transport.spawn = async (options) => {
          capture = { args: options.args, cwd: options.cwd };
          await originalSpawn(options);
        };
        return transport;
      },
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    expect(capture?.args).toEqual(['--mode', 'rpc', '--offline', '--no-session']);
    expect(capture?.cwd).toBe('/tmp/work');
    expect((await adapter.status()).state).toBe('running');
    expect((await adapter.status()).startedAt).toBeInstanceOf(Date);
  });

  it('rejects second start without stop', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport({ onCommand: defaultPiHandler }),
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    await expect(adapter.start({ workingDirectory: '/tmp/work' })).rejects.toMatchObject({
      code: 'invalid-state'
    });
  });

  it('sends initialInstructions as first prompt on start', async () => {
    const writes: string[] = [];
    const adapter = new PiAgentAdapter({
      transportFactory: () =>
        createInMemoryPiTransport({
          onCommand: defaultPiHandler,
          onWrite: (line) => writes.push(line)
        }),
      access: async () => {}
    });

    await adapter.start({
      workingDirectory: '/tmp/work',
      initialInstructions: 'bootstrap context'
    });

    expect(
      writes.some(
        (line) => line.includes('bootstrap context') && line.includes('"type":"prompt"')
      )
    ).toBe(true);
  });

  it('throws start-failed when cwd is inaccessible', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport(),
      access: async () => {
        throw new Error('ENOENT');
      }
    });

    await expect(
      adapter.start({ workingDirectory: '/missing' })
    ).rejects.toMatchObject({ code: 'start-failed' });
    expect((await adapter.status()).state).toBe('error');
    expect((await adapter.status()).error).toBeTruthy();
  });

  it('observes starting during async spawn', async () => {
    const states: AgentState[] = [];
    const adapter = new PiAgentAdapter({
      transportFactory: () =>
        createInMemoryPiTransport({ onCommand: defaultPiHandler, spawnDelayMs: 20 }),
      access: async () => {}
    });

    const startPromise = adapter.start({ workingDirectory: '/tmp/work' });
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    states.push((await adapter.status()).state);
    await startPromise;
    states.push((await adapter.status()).state);

    expect(states).toContain('starting');
    expect(states.at(-1)).toBe('running');
  });

  it('send returns assistant text and updates lastActivityAt', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport({ onCommand: defaultPiHandler }),
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    const before = (await adapter.status()).lastActivityAt;
    const response = await adapter.send('hello');
    const after = (await adapter.status()).lastActivityAt;

    expect(response.output).toBe('done');
    expect(after).toBeDefined();
    expect(after).not.toEqual(before);
  });

  it('send before start rejects with invalid-state', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport()
    });

    await expect(adapter.send('hi')).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('send-failed when prompt is rejected', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () =>
        createInMemoryPiTransport({
          onCommand: (command, emit) => {
            if (command.type === 'prompt') {
              emit({
                type: 'response',
                command: 'prompt',
                success: false,
                id: command.id
              });
            }
          }
        }),
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    await expect(adapter.send('fail')).rejects.toMatchObject({ code: 'send-failed' });
    expect((await adapter.status()).state).toBe('error');
  });

  it('stop is idempotent and allows restart', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport({ onCommand: defaultPiHandler }),
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    await adapter.stop();
    await adapter.stop();
    expect((await adapter.status()).state).toBe('stopped');

    await adapter.start({ workingDirectory: '/tmp/work' });
    expect((await adapter.status()).state).toBe('running');
  });

  it('observes stopping during async kill', async () => {
    const adapter = new PiAgentAdapter({
      transportFactory: () => {
        const transport = createInMemoryPiTransport({ onCommand: defaultPiHandler });
        const originalKill = transport.kill.bind(transport);
        transport.kill = async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 20);
          });
          await originalKill();
        };
        return transport;
      },
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    const stopPromise = adapter.stop();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5);
    });
    expect((await adapter.status()).state).toBe('stopping');
    await stopPromise;
    expect((await adapter.status()).state).toBe('stopped');
  });

  it('maps unexpected process exit to error', async () => {
    let transport!: ReturnType<typeof createInMemoryPiTransport>;
    const adapter = new PiAgentAdapter({
      transportFactory: () => {
        transport = createInMemoryPiTransport({ onCommand: defaultPiHandler });
        return transport;
      },
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    transport.emitClose(1);
    expect((await adapter.status()).state).toBe('error');
    expect((await adapter.status()).error).toContain('exited');
  });

  it('readLogs accumulates stdout and sets truncated when over cap', async () => {
    const adapter = new PiAgentAdapter({
      maxLogBytes: 32,
      transportFactory: () => {
        const transport = createInMemoryPiTransport({ onCommand: defaultPiHandler });
        const originalSpawn = transport.spawn.bind(transport);
        transport.spawn = async (options) => {
          await originalSpawn(options);
          transport.pushStdoutLine('x'.repeat(40));
        };
        return transport;
      },
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    const logs = await adapter.readLogs();
    expect(logs.stdout.length).toBeGreaterThan(0);
    expect(logs.combined).toContain('[stdout]');
    expect(logs.truncated).toBe(true);
    expect(logs.stdout.length + logs.stderr.length).toBeLessThanOrEqual(32);
  });

  it('readLogs accumulates stderr into combined output', async () => {
    let transport!: ReturnType<typeof createInMemoryPiTransport>;
    const adapter = new PiAgentAdapter({
      transportFactory: () => {
        transport = createInMemoryPiTransport({ onCommand: defaultPiHandler });
        return transport;
      },
      access: async () => {}
    });

    await adapter.start({ workingDirectory: '/tmp/work' });
    transport.emitStderr('warn line\n');

    const logs = await adapter.readLogs();
    expect(logs.stderr).toContain('warn line');
    expect(logs.combined).toContain('[stderr] warn line');
  });
});

describe('PiAgentAdapter structural', () => {
  it('implements AgentAdapter', () => {
    const adapter: import('../../src/agents/types.js').AgentAdapter = new PiAgentAdapter({
      transportFactory: () => createInMemoryPiTransport()
    });
    expect(adapter).toBeDefined();
  });
});
