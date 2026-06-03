import { describe, expect, it } from 'vitest';

import {
  createInMemoryPiTransport,
  parsePiLine,
  PiRpcSession,
  splitJsonlLines
} from '../../src/agents/pi-rpc.js';

describe('splitJsonlLines', () => {
  it('splits on LF only', () => {
    expect(splitJsonlLines('a\nb\n')).toEqual({ lines: ['a', 'b'], remainder: '' });
  });

  it('strips trailing CR from CRLF', () => {
    expect(splitJsonlLines('{"a":1}\r\n')).toEqual({
      lines: ['{"a":1}'],
      remainder: ''
    });
  });

  it('keeps remainder without trailing newline', () => {
    expect(splitJsonlLines('partial')).toEqual({ lines: [], remainder: 'partial' });
  });

  it('does not split on U+2028 inside JSON', () => {
    const payload = '{"text":"line\u2028separator"}';
    expect(splitJsonlLines(`${payload}\n`)).toEqual({ lines: [payload], remainder: '' });
  });
});

describe('parsePiLine', () => {
  it('parses JSON objects', () => {
    expect(parsePiLine('{"type":"agent_start"}')).toEqual({ type: 'agent_start' });
  });

  it('returns null for empty lines', () => {
    expect(parsePiLine('')).toBeNull();
    expect(parsePiLine('   ')).toBeNull();
  });
});

describe('PiRpcSession', () => {
  it('prompt waits for agent_end and returns success', async () => {
    const transport = createInMemoryPiTransport({
      onCommand: (command, emit) => {
        if (command.type === 'prompt') {
          emit({ type: 'response', command: 'prompt', success: true });
          emit({ type: 'agent_end', messages: [] });
        }
      }
    });

    const session = new PiRpcSession(transport);
    transport.onStdoutLine((line) => {
      session.feedStdout(`${line}\n`);
    });
    await session.prompt('hello');
    expect(session.isIdle()).toBe(true);
  });

  it('getLastAssistantText returns scripted text', async () => {
    const transport = createInMemoryPiTransport({
      onCommand: (command, emit) => {
        if (command.type === 'get_last_assistant_text') {
          emit({
            type: 'response',
            command: 'get_last_assistant_text',
            success: true,
            data: { text: 'done' }
          });
        }
      }
    });

    const session = new PiRpcSession(transport);
    transport.onStdoutLine((line) => {
      session.feedStdout(`${line}\n`);
    });
    await expect(session.getLastAssistantText()).resolves.toBe('done');
  });

  it('auto-cancels extension UI dialog requests', async () => {
    const writes: string[] = [];
    const transport = createInMemoryPiTransport({
      onWrite: (line) => {
        writes.push(line);
      }
    });

    const session = new PiRpcSession(transport);
    transport.onStdoutLine((line) => {
      session.feedStdout(`${line}\n`);
    });
    transport.pushStdoutLine(
      JSON.stringify({
        type: 'extension_ui_request',
        id: 'ui-1',
        method: 'confirm',
        title: 'Allow?'
      })
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });

    expect(writes.some((line) => line.includes('extension_ui_response'))).toBe(true);
    expect(writes.some((line) => line.includes('"cancelled":true'))).toBe(true);
    expect(session.isIdle()).toBe(true);
  });
});
