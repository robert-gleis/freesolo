export type {
  AgentAdapter,
  AgentResponse,
  AgentStartInput,
  AgentState,
  AgentStatus,
  AgentAdapterErrorCode
} from './types.js';
export { AgentAdapterError } from './types.js';

export { ScriptedAgentAdapter } from './scripted.js';
export type { AgentScript, ScriptStep } from './scripted.js';

export { ClaudeCodeAgentAdapter } from './claude-code.js';
export type {
  ClaudeCodeAgentAdapterOptions,
  ClaudeInvokeInput,
  ClaudeInvoker,
  ClaudePrintJson
} from './claude-code.js';

export {
  CodexAgentAdapter,
  createDefaultInvoker,
  parseCodexExecJsonl
} from './codex.js';
export type {
  CodexAgentAdapterOptions,
  CodexInvokeInput,
  CodexInvokeResult,
  CodexInvoker
} from './codex.js';

export {
  CursorAgentAdapter,
  createCursorAgentAdapter,
  createDefaultCursorAgentDeps,
  parseCursorAgentJson
} from './cursor.js';
export type {
  CursorAgentDeps,
  CursorAgentRunOptions,
  CursorAgentRunResult
} from './cursor.js';

export type { AgentLogOptions, AgentLogSnapshot } from './log-snapshot.js';

export { runReviewAgent, reviewVerdictSchema, reviewFindingSchema } from './review-runner.js';
export type { ReviewVerdict, ReviewFinding, RunReviewAgentInput } from './review-runner.js';

export { runFixerAgent } from './fixer-runner.js';
export type { RunFixerAgentInput, FixerAgentResult } from './fixer-runner.js';

import type { HostTool } from '../core/types.js';
import type { AgentAdapter } from './types.js';
import { ClaudeCodeAgentAdapter } from './claude-code.js';
import { CodexAgentAdapter } from './codex.js';
import { createCursorAgentAdapter } from './cursor.js';

/**
 * Resolves a fresh host-agnostic {@link AgentAdapter} for a {@link HostTool}.
 * Host-keyed and exhaustive over HOST_TOOLS ('codex' | 'claude' | 'cursor').
 * Callers that need a fake (tests) construct a ScriptedAgentAdapter
 * directly instead of going through this factory.
 */
export function getAgentAdapter(host: HostTool): AgentAdapter {
  switch (host) {
    case 'claude':
      return new ClaudeCodeAgentAdapter();
    case 'codex':
      return new CodexAgentAdapter();
    case 'cursor':
      return createCursorAgentAdapter();
    default: {
      const exhaustive: never = host;
      throw new Error(`unsupported host tool: ${String(exhaustive)}`);
    }
  }
}
