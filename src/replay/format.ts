import type { ReplayStep, WorkflowReplay } from './types.js';

function formatAction(action: Record<string, unknown>): string {
  const kind = typeof action.kind === 'string' ? action.kind : 'unknown';
  if (kind === 'wait' && typeof action.reason === 'string') {
    return `wait (${action.reason})`;
  }
  if (kind === 'transition' && typeof action.to === 'string') {
    return `transition → ${action.to}`;
  }
  if (kind === 'spawn') {
    return 'spawn agent';
  }
  if (kind === 'refuse' && typeof action.reason === 'string') {
    return `refuse (${action.reason})`;
  }
  return kind;
}

function formatStep(step: ReplayStep): string[] {
  switch (step.kind) {
    case 'workflow.decision':
      return [
        `[${step.at}] workflow.decision ${step.fromState ?? '(none)'} → ${formatAction(step.action)}`
      ];
    case 'workflow.transition':
      return [`[${step.at}] workflow.transition ${step.from} → ${step.to}`];
    case 'agent.lifecycle':
      return [`[${step.at}] ${step.eventType} agent=${step.agentId}`];
    case 'agent.log':
      return [
        `[${step.at}] agent.log agent=${step.agentId}${step.truncated ? ' (truncated)' : ''}`,
        '--- stdout ---',
        step.stdout || '(empty)',
        '--- stderr ---',
        step.stderr || '(empty)'
      ];
    default:
      return [];
  }
}

export function formatReplayText(replay: WorkflowReplay): string {
  const header = [
    `Issue #${replay.issueId} Session Replay`,
    replay.workflowId ? `Workflow: ${replay.workflowId}` : 'Workflow: (none)',
    replay.startedAt ? `Started: ${replay.startedAt}` : null,
    replay.endedAt ? `Ended: ${replay.endedAt}` : null,
    ''
  ].filter((line): line is string => line !== null);

  const body = replay.steps.flatMap((step) => formatStep(step));
  return [...header, ...body].join('\n');
}

export function formatReplayJson(replay: WorkflowReplay): string {
  return JSON.stringify(replay, null, 2);
}
