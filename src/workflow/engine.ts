import type { AgentAdapter } from '../agents/index.js';
import type { EngineAction, PolicyInput } from './policy.js';
import { InvalidTransitionError, type WorkflowState } from './state-machine.js';
import {
  InvalidStateLabelError,
  MultipleStateLabelsError,
  type RepoRef
} from './state-store.js';

export type { EngineAction, PolicyInput, AgentTaskRequest } from './policy.js';

export type EngineRefusalCode =
  | 'no-state'
  | 'malformed-state'
  | 'terminal-state'
  | 'invalid-transition'
  | 'no-agent-adapter'
  | 'policy-refused';

export interface TickResult {
  issueNumber: number;
  fromState: WorkflowState | null;
  action: EngineAction;
  toState: WorkflowState | null;
  refused?: { code: EngineRefusalCode; reason: string };
}

export type WorkflowEngineEvent =
  | {
      kind: 'decision';
      at: Date;
      issueNumber: number;
      fromState: WorkflowState | null;
      action: EngineAction;
    }
  | {
      kind: 'transition';
      at: Date;
      issueNumber: number;
      from: WorkflowState;
      to: WorkflowState;
    };

export interface WorkflowEngineDeps {
  readState: (repo: RepoRef, issue: number) => Promise<WorkflowState | null>;
  writeState: (
    repo: RepoRef,
    issue: number,
    from: WorkflowState,
    to: WorkflowState
  ) => Promise<void>;
  policy: (input: PolicyInput) => EngineAction;
  agent?: AgentAdapter;
  now?: () => Date;
}

export interface WorkflowEngine {
  tick(input: { repo: RepoRef; issueNumber: number }): Promise<TickResult>;
  on(handler: (event: WorkflowEngineEvent) => void): () => void;
}

export function createWorkflowEngine(deps: WorkflowEngineDeps): WorkflowEngine {
  const subscribers = new Set<(event: WorkflowEngineEvent) => void>();
  const now = deps.now ?? (() => new Date());

  const emit = (event: WorkflowEngineEvent): void => {
    for (const handler of subscribers) {
      try {
        handler(event);
      } catch {
        // Swallow subscriber errors; the engine must not crash because a logger threw.
      }
    }
  };

  const refuse = (
    issueNumber: number,
    fromState: WorkflowState | null,
    code: EngineRefusalCode,
    reason: string
  ): TickResult => {
    const action: EngineAction = { kind: 'refuse', reason };
    emit({ kind: 'decision', at: now(), issueNumber, fromState, action });
    return {
      issueNumber,
      fromState,
      toState: null,
      action,
      refused: { code, reason }
    };
  };

  return {
    on(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    },

    async tick({ repo, issueNumber }) {
      let current: WorkflowState | null;
      try {
        current = await deps.readState(repo, issueNumber);
      } catch (error) {
        if (
          error instanceof MultipleStateLabelsError ||
          error instanceof InvalidStateLabelError
        ) {
          return refuse(issueNumber, null, 'malformed-state', error.message);
        }
        throw error;
      }

      if (current === null) {
        return refuse(issueNumber, null, 'no-state', 'issue has no state label');
      }

      if (current === 'closed') {
        return refuse(
          issueNumber,
          current,
          'terminal-state',
          'issue is in terminal state "closed"'
        );
      }

      const action = deps.policy({ state: current, issueNumber, repo });
      emit({ kind: 'decision', at: now(), issueNumber, fromState: current, action });

      if (action.kind === 'wait') {
        return { issueNumber, fromState: current, toState: current, action };
      }

      if (action.kind === 'transition') {
        try {
          await deps.writeState(repo, issueNumber, current, action.to);
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            return {
              issueNumber,
              fromState: current,
              toState: null,
              action,
              refused: { code: 'invalid-transition', reason: error.message }
            };
          }
          throw error;
        }
        emit({
          kind: 'transition',
          at: now(),
          issueNumber,
          from: current,
          to: action.to
        });
        return { issueNumber, fromState: current, toState: action.to, action };
      }

      if (action.kind === 'spawn') {
        if (!deps.agent) {
          return {
            issueNumber,
            fromState: current,
            toState: null,
            action,
            refused: {
              code: 'no-agent-adapter',
              reason: 'policy returned a spawn action but no agent adapter is configured'
            }
          };
        }

        await deps.agent.start({
          workingDirectory: action.agent.workingDirectory,
          initialInstructions: action.agent.initialInstructions
        });
        await deps.agent.send(action.agent.initialInstructions);

        try {
          await deps.writeState(repo, issueNumber, current, action.nextState);
        } catch (error) {
          if (error instanceof InvalidTransitionError) {
            return {
              issueNumber,
              fromState: current,
              toState: null,
              action,
              refused: { code: 'invalid-transition', reason: error.message }
            };
          }
          throw error;
        }
        emit({
          kind: 'transition',
          at: now(),
          issueNumber,
          from: current,
          to: action.nextState
        });
        return { issueNumber, fromState: current, toState: action.nextState, action };
      }

      return {
        issueNumber,
        fromState: current,
        toState: null,
        action,
        refused: { code: 'policy-refused', reason: action.reason }
      };
    }
  };
}
