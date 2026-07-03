import { describe, expect, it } from 'vitest';

import {
  ClaudeCodeAgentAdapter,
  CodexAgentAdapter,
  CursorAgentAdapter,
  getAgentAdapter
} from '../../src/agents/index.js';
import { HOST_TOOLS } from '../../src/core/types.js';

describe('getAgentAdapter', () => {
  it('returns a ClaudeCodeAgentAdapter for host "claude"', () => {
    expect(getAgentAdapter('claude')).toBeInstanceOf(ClaudeCodeAgentAdapter);
  });

  it('returns a CodexAgentAdapter for host "codex"', () => {
    expect(getAgentAdapter('codex')).toBeInstanceOf(CodexAgentAdapter);
  });

  it('returns a CursorAgentAdapter for host "cursor"', () => {
    expect(getAgentAdapter('cursor')).toBeInstanceOf(CursorAgentAdapter);
  });

  it('covers every HostTool', () => {
    for (const host of HOST_TOOLS) {
      expect(() => getAgentAdapter(host)).not.toThrow();
    }
  });
});
