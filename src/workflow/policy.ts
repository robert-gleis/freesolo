import type { WorkflowState } from './state-machine.js';
import type { RepoRef } from './state-store.js';

export interface PolicyInput {
  state: WorkflowState;
  issueNumber: number;
  repo: RepoRef;
}

export interface AgentTaskRequest {
  workingDirectory: string;
  initialInstructions: string;
}

export type EngineAction =
  | { kind: 'transition'; to: WorkflowState }
  | { kind: 'wait'; reason: string }
  | { kind: 'spawn'; agent: AgentTaskRequest; nextState: WorkflowState }
  | { kind: 'refuse'; reason: string };

export function defaultPolicy(input: PolicyInput): EngineAction {
  if (input.state === 'merged') {
    return { kind: 'transition', to: 'closed' };
  }
  if (input.state === 'closed') {
    return { kind: 'wait', reason: 'issue is closed' };
  }
  return { kind: 'wait', reason: `agent owns work in state "${input.state}"` };
}
