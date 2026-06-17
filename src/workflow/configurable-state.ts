import { loadConfig } from '../config/load.js';
import {
  initializeState as localInitializeState,
  readState as localReadState,
  writeState as localWriteState,
} from './local-state-store.js';
import { readState as githubReadState, writeState as githubWriteState, type RepoRef } from './state-store.js';
import type { WorkflowState } from './state-machine.js';

async function useLocalBackend(): Promise<boolean> {
  const config = await loadConfig();
  return config.state_backend === 'local';
}

export async function readState(repo: RepoRef, issueNumber: number): Promise<WorkflowState | null> {
  return (await useLocalBackend())
    ? localReadState(repo, issueNumber)
    : githubReadState(repo, issueNumber);
}

export async function writeState(
  repo: RepoRef,
  issueNumber: number,
  from: WorkflowState,
  to: WorkflowState
): Promise<void> {
  return (await useLocalBackend())
    ? localWriteState(repo, issueNumber, from, to)
    : githubWriteState(repo, issueNumber, from, to);
}

export async function initializeState(
  repo: RepoRef,
  issueNumber: number,
  initialState: WorkflowState
): Promise<void> {
  if (await useLocalBackend()) {
    return localInitializeState(repo, issueNumber, initialState);
  }

  throw new Error('Issue initialization is only supported with state_backend: local');
}
