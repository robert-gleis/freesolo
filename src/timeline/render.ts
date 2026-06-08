import type { Timeline } from './types.js';

function formatAttemptLine(label: string, at: string, marker: string, detail?: string): string {
  const suffix = detail ? ` (${detail})` : '';
  return `${label.padEnd(16)} ${at} ${marker}${suffix}`;
}

export function renderTimelineJson(timeline: Timeline): string {
  return `${JSON.stringify(timeline, null, 2)}\n`;
}

export function renderTimelineText(timeline: Timeline): string {
  const lines = [`Issue #${timeline.issueNumber}`, ''];

  for (const step of timeline.steps) {
    if (step.status === 'pending') {
      lines.push(`${step.label.padEnd(16)} pending`);
      continue;
    }

    if (step.attempts.length === 0) {
      lines.push(`${step.label.padEnd(16)} pending`);
      continue;
    }

    step.attempts.forEach((attempt, index) => {
      const marker = attempt.status === 'completed' ? '✓' : '✗';
      const label = index === 0 ? step.label : '';
      lines.push(formatAttemptLine(label, attempt.at, marker, attempt.detail));
    });
  }

  return `${lines.join('\n')}\n`;
}
