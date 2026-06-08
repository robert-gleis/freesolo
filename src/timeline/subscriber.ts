import type { EventLog } from '../event-log/types.js';
import type { WorkflowEngineEvent } from '../workflow/engine.js';

export function createWorkflowEventSubscriber(
  eventLog: EventLog,
  options: { workflowId?: string } = {}
): (event: WorkflowEngineEvent) => void {
  return (engineEvent) => {
    if (engineEvent.kind === 'transition') {
      eventLog.append({
        eventType: 'workflow.transition',
        issueId: engineEvent.issueNumber,
        workflowId: options.workflowId,
        payload: {
          from: engineEvent.from,
          to: engineEvent.to
        }
      });
      return;
    }

    if (engineEvent.action.kind === 'refuse') {
      eventLog.append({
        eventType: 'workflow.refused',
        issueId: engineEvent.issueNumber,
        workflowId: options.workflowId,
        payload: {
          fromState: engineEvent.fromState,
          code: 'refuse',
          reason: engineEvent.action.reason
        }
      });
    }
  };
}
