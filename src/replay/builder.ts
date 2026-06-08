import { openEventLog } from '../event-log/store.js';
import type { EventLog } from '../event-log/types.js';
import { EventLogError } from '../event-log/types.js';
import { openAgentLogStore, type AgentLogStore } from './log-store.js';
import { ReplayError, type ReplayStep, type WorkflowReplay } from './types.js';

export interface BuildWorkflowReplayInput {
  issueId: number;
  eventLog?: EventLog;
  logStore?: AgentLogStore;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function mapEventToStep(
  event: ReturnType<EventLog['list']>[number],
  logStore: AgentLogStore
): ReplayStep | null {
  switch (event.eventType) {
    case 'workflow.decision':
      return {
        kind: 'workflow.decision',
        at: event.createdAt,
        fromState:
          event.payload.fromState === null || typeof event.payload.fromState === 'string'
            ? (event.payload.fromState as string | null)
            : null,
        action: asRecord(event.payload.action)
      };
    case 'workflow.transition':
      return {
        kind: 'workflow.transition',
        at: event.createdAt,
        from: asString(event.payload.from),
        to: asString(event.payload.to)
      };
    case 'agent.created':
    case 'agent.stopped':
      return {
        kind: 'agent.lifecycle',
        at: event.createdAt,
        eventType: event.eventType,
        agentId: event.agentId ?? 'unknown',
        payload: event.payload
      };
    case 'agent.log.captured': {
      const snapshotId = event.payload.snapshotId;
      if (typeof snapshotId !== 'number') {
        throw new ReplayError('store-error', `agent.log.captured missing snapshotId for event ${event.id}`);
      }
      const snapshot = logStore.read(snapshotId);
      if (!snapshot) {
        throw new ReplayError('store-error', `agent log snapshot ${snapshotId} not found`);
      }
      return {
        kind: 'agent.log',
        at: event.createdAt,
        agentId: event.agentId ?? snapshot.agentId,
        stdout: snapshot.stdout,
        stderr: snapshot.stderr,
        truncated: snapshot.truncated
      };
    }
    default:
      return null;
  }
}

export function buildWorkflowReplay(input: BuildWorkflowReplayInput): WorkflowReplay {
  const ownsEventLog = input.eventLog === undefined;
  const ownsLogStore = input.logStore === undefined;
  const eventLog = input.eventLog ?? openEventLog();
  const logStore = input.logStore ?? openAgentLogStore({ path: eventLog.path });

  try {
    let events;
    try {
      events = eventLog.list({ issueId: input.issueId, order: 'asc', limit: 1000 });
    } catch (error) {
      if (error instanceof EventLogError && error.code === 'closed') {
        throw new ReplayError('closed', error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new ReplayError('store-error', message);
    }

    if (events.length === 0) {
      throw new ReplayError('no-events', `no events found for issue ${input.issueId}`);
    }

    const steps: ReplayStep[] = [];
    let workflowId: string | null = null;

    for (const event of events) {
      if (workflowId === null && event.workflowId) {
        workflowId = event.workflowId;
      }
      const step = mapEventToStep(event, logStore);
      if (step) {
        steps.push(step);
      }
    }

    if (steps.length === 0) {
      throw new ReplayError('no-events', `no replayable events found for issue ${input.issueId}`);
    }

    return {
      issueId: input.issueId,
      workflowId,
      steps,
      startedAt: steps[0]?.at ?? null,
      endedAt: steps.at(-1)?.at ?? null
    };
  } catch (error) {
    if (error instanceof ReplayError) {
      throw error;
    }
    if (error instanceof EventLogError && error.code === 'closed') {
      throw new ReplayError('closed', error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ReplayError('store-error', message);
  } finally {
    if (ownsLogStore) {
      logStore.close();
    }
    if (ownsEventLog) {
      eventLog.close();
    }
  }
}
