export type TimelineStepId = 'planned' | 'implemented' | 'reviewed' | 'verified' | 'pr-created';

export type TimelineStepStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TimelineAttempt {
  at: string;
  status: 'completed' | 'failed';
  detail?: string;
  eventId: number;
}

export interface TimelineStep {
  id: TimelineStepId;
  label: string;
  status: TimelineStepStatus;
  attempts: TimelineAttempt[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface Timeline {
  issueNumber: number;
  steps: TimelineStep[];
  hasActivity: boolean;
}
