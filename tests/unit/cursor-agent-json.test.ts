import { describe, expect, it } from 'vitest';

import { parseCursorAgentJson } from '../../src/agents/cursor.js';

describe('parseCursorAgentJson', () => {
  it('parses a success line with session_id and result', () => {
    const stdout = '{"type":"result","result":"hello","session_id":"abc-123"}\n';
    const parsed = parseCursorAgentJson(stdout);
    expect(parsed).toEqual({ sessionId: 'abc-123', output: 'hello' });
  });

  it('uses the last JSON line when stdout has noise before it', () => {
    const stdout = 'log line\n{"type":"result","result":"ok","session_id":"x"}\n';
    const parsed = parseCursorAgentJson(stdout);
    expect(parsed.output).toBe('ok');
  });

  it('throws when no JSON line is present', () => {
    expect(() => parseCursorAgentJson('not json\n')).toThrow(/JSON/);
  });

  it('throws when result field is missing', () => {
    const stdout = '{"type":"result","session_id":"x"}\n';
    expect(() => parseCursorAgentJson(stdout)).toThrow(/result/);
  });

  it('throws when session_id field is missing', () => {
    const stdout = '{"type":"result","result":"ok"}\n';
    expect(() => parseCursorAgentJson(stdout)).toThrow(/session_id/);
  });
});
