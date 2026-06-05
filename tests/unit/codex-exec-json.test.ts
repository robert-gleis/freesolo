import { describe, expect, it } from 'vitest';

import { parseCodexExecJsonl } from '../../src/agents/codex.js';

const FIXTURE = [
  '{"type":"thread.started","thread_id":"thread-abc"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello from Codex"}}',
  '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
].join('\n');

describe('parseCodexExecJsonl', () => {
  it('extracts thread_id and last agent_message text', () => {
    expect(parseCodexExecJsonl(FIXTURE)).toEqual({
      threadId: 'thread-abc',
      output: 'Hello from Codex'
    });
  });

  it('uses the last agent_message when multiple exist', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t1"}',
      '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"first"}}',
      '{"type":"item.completed","item":{"id":"b","type":"agent_message","text":"second"}}'
    ].join('\n');
    expect(parseCodexExecJsonl(stdout).output).toBe('second');
  });

  it('throws when stdout is empty', () => {
    expect(() => parseCodexExecJsonl('')).toThrow(/thread_id/);
  });

  it('throws when stdout is whitespace-only', () => {
    expect(() => parseCodexExecJsonl('  \n  ')).toThrow(/thread_id/);
  });

  it('throws when thread_id missing', () => {
    expect(() => parseCodexExecJsonl('{"type":"turn.started"}')).toThrow(/thread_id/);
  });

  it('throws when no agent_message', () => {
    expect(() =>
      parseCodexExecJsonl('{"type":"thread.started","thread_id":"t"}\n{"type":"turn.completed"}')
    ).toThrow(/agent_message/);
  });

  it('throws on turn.failed', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.failed","error":{"message":"boom"}}'
    ].join('\n');
    expect(() => parseCodexExecJsonl(stdout)).toThrow(/boom/);
  });

  it('throws on top-level error line', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"error","message":"fatal CLI error"}'
    ].join('\n');
    expect(() => parseCodexExecJsonl(stdout)).toThrow(/fatal CLI error/);
  });

  it('skips non-JSON lines and still parses valid events', () => {
    const stdout = [
      'not json',
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"ok"}}'
    ].join('\n');
    expect(parseCodexExecJsonl(stdout)).toEqual({ threadId: 't', output: 'ok' });
  });

  it('ignores transient Reconnecting error lines', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"error","message":"Reconnecting..."}',
      '{"type":"item.completed","item":{"id":"a","type":"agent_message","text":"ok"}}'
    ].join('\n');
    expect(parseCodexExecJsonl(stdout)).toEqual({ threadId: 't', output: 'ok' });
  });
});
