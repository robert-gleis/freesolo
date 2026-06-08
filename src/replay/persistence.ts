import type { AgentLogSnapshot } from '../agents/log-snapshot.js';
import type { EventLog } from '../event-log/types.js';
import type { WorkflowEngine } from '../workflow/engine.js';
import type { AgentLogStore } from './log-store.js';

export function persistWorkflowEngineEvents(
  engine: WorkflowEngine,
  context: { issueId: number; workflowId?: string; eventLog: EventLog }
): () => void {
  return engine.on((event) => {
    if (event.kind === 'decision') {
      context.eventLog.append({
        eventType: 'workflow.decision',
        issueId: context.issueId,
        workflowId: context.workflowId,
        payload: { fromState: event.fromState, action: event.action }
      });
    }
    if (event.kind === 'transition') {
      context.eventLog.append({
        eventType: 'workflow.transition',
        issueId: context.issueId,
        workflowId: context.workflowId,
        payload: { from: event.from, to: event.to }
      });
    }
  });
}

export function captureAgentLogSnapshot(input: {
  agentId: string;
  issueId: number;
  workflowId?: string;
  snapshot: AgentLogSnapshot;
  eventLog: EventLog;
  logStore: AgentLogStore;
}): void {
  const row = input.logStore.capture({
    agentId: input.agentId,
    issueId: input.issueId,
    workflowId: input.workflowId,
    stdout: input.snapshot.stdout,
    stderr: input.snapshot.stderr,
    truncated: input.snapshot.truncated
  });
  input.eventLog.append({
    eventType: 'agent.log.captured',
    agentId: input.agentId,
    issueId: input.issueId,
    workflowId: input.workflowId,
    payload: {
      snapshotId: row.id,
      truncated: row.truncated,
      stdoutBytes: row.stdout.length,
      stderrBytes: row.stderr.length
    }
  });
}
