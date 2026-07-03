import type { AgentRoleAssignment } from '../team/types.js';
import type { WorkflowState } from './state-machine.js';
import type { RepoRef } from '../core/types.js';

export interface PolicyInput {
  state: WorkflowState;
  issueNumber: number;
  repo: RepoRef;
}

export interface AgentTaskRequest {
  agentId?: string;
  role?: AgentRoleAssignment;
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
