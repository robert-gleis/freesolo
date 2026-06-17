import type { StateDb } from '../state/db.js';
import {
  enqueueIssue,
  getCursor,
  getIntakeDecision,
  listPending,
  markIntakeAccepted,
  markIntakeIgnored,
  markDone,
  markFailed,
  markProcessing,
  recoverStaleProcessing,
  setCursor
} from '../state/watcher-store.js';
import type { WatcherIntakeMode, WatcherSource } from '../config/types.js';
import type { WorkflowState } from '../workflow/state-machine.js';
import type { RepoRef } from '../workflow/state-store.js';
import type { WatchIssue, PollResult } from './poll.js';
import type { TickResult } from '../workflow/engine.js';

export interface WatchCycleDeps {
  db: StateDb;
  repo: RepoRef;
  source: WatcherSource;
  intakeMode: WatcherIntakeMode;
  initialState: WorkflowState;
  triggerLabel: string;
  sinceOverride?: string;
  poll: (since: string) => Promise<PollResult>;
  confirmIntake?: (issue: WatchIssue) => Promise<boolean>;
  readState: (repo: RepoRef, issueNumber: number) => Promise<WorkflowState | null>;
  initializeState: (input: { repo: RepoRef; issueNumber: number; initialState: WorkflowState }) => Promise<void>;
  tick: (input: { repo: RepoRef; issueNumber: number }) => Promise<TickResult>;
  now?: () => Date;
}

export interface WatchCycleResult {
  enqueued: number;
  processed: number;
  failed: number;
  rateLimited: boolean;
  pollError?: string;
}

const STALE_PROCESSING_MS = 5 * 60_000;

function maxIso(left: string, right: string): string {
  return left >= right ? left : right;
}

async function shouldEnqueueIssue(deps: WatchCycleDeps, issue: WatchIssue): Promise<boolean> {
  const decision = getIntakeDecision(deps.db, deps.repo, issue.number);
  if (decision?.decision === 'ignored') {
    return false;
  }
  if (decision?.decision === 'accepted') {
    return true;
  }

  const state = await deps.readState(deps.repo, issue.number);
  if (state !== null) {
    markIntakeAccepted(deps.db, deps.repo, issue.number, issue.updatedAt);
    return true;
  }

  if (deps.intakeMode === 'auto') {
    await deps.initializeState({
      repo: deps.repo,
      issueNumber: issue.number,
      initialState: deps.initialState
    });
    markIntakeAccepted(deps.db, deps.repo, issue.number, issue.updatedAt);
    return true;
  }

  if (!deps.confirmIntake) {
    throw new Error('watcher intake confirmation requires an interactive prompt');
  }

  const confirmed = await deps.confirmIntake(issue);
  if (!confirmed) {
    markIntakeIgnored(deps.db, deps.repo, issue.number, issue.updatedAt);
    return false;
  }

  await deps.initializeState({
    repo: deps.repo,
    issueNumber: issue.number,
    initialState: deps.initialState
  });
  markIntakeAccepted(deps.db, deps.repo, issue.number, issue.updatedAt);
  return true;
}

export async function runWatchCycle(deps: WatchCycleDeps): Promise<WatchCycleResult> {
  const now = deps.now ?? (() => new Date());
  recoverStaleProcessing(deps.db, deps.repo, STALE_PROCESSING_MS);

  const cursor = deps.sinceOverride ?? getCursor(deps.db, deps.repo) ?? now().toISOString();
  const hadNullCursor = getCursor(deps.db, deps.repo) === null && !deps.sinceOverride;
  const pollResult = await deps.poll(cursor);

  if (pollResult.rateLimited) {
    return { enqueued: 0, processed: 0, failed: 0, rateLimited: true };
  }

  if (pollResult.error) {
    return { enqueued: 0, processed: 0, failed: 0, rateLimited: false, pollError: pollResult.error };
  }

  let enqueued = 0;
  for (const issue of pollResult.issues) {
    if ((await shouldEnqueueIssue(deps, issue)) && enqueueIssue(deps.db, deps.repo, issue.number, issue.updatedAt)) {
      enqueued += 1;
    }
  }

  let processed = 0;
  let failed = 0;
  let maxUpdatedAt = cursor;

  for (const row of listPending(deps.db, deps.repo)) {
    markProcessing(deps.db, row.id);
    try {
      const tickResult = await deps.tick({ repo: deps.repo, issueNumber: row.issue_number });
      if (tickResult.refused && tickResult.refused.code !== 'no-state') {
        markFailed(deps.db, row.id, tickResult.refused.reason);
        failed += 1;
        continue;
      }
      markDone(deps.db, row.id);
      processed += 1;
      maxUpdatedAt = maxIso(maxUpdatedAt, row.issue_updated_at);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markFailed(deps.db, row.id, message);
      failed += 1;
    }
  }

  if (processed > 0 || pollResult.issues.length === 0) {
    setCursor(deps.db, deps.repo, maxUpdatedAt);
  } else if (enqueued === 0 && pollResult.issues.length > 0) {
    const latest = pollResult.issues.reduce((acc, issue) => maxIso(acc, issue.updatedAt), cursor);
    setCursor(deps.db, deps.repo, latest);
  } else if (hadNullCursor && enqueued > 0 && processed === 0) {
    setCursor(deps.db, deps.repo, cursor);
  }

  return { enqueued, processed, failed, rateLimited: false };
}

export interface WatchLoopDeps extends WatchCycleDeps {
  intervalMs: number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  onCycleResult?: (result: WatchCycleResult) => void;
}

export async function runWatchLoop(deps: WatchLoopDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let backoffMs = 0;

  for (;;) {
    const result = await runWatchCycle(deps);
    deps.onCycleResult?.(result);

    if (deps.signal?.aborted) {
      return;
    }

    if (result.pollError) {
      backoffMs = 0;
      await sleep(deps.intervalMs);
      if (deps.signal?.aborted) {
        return;
      }
      continue;
    }

    if (result.rateLimited) {
      backoffMs = backoffMs === 0 ? 60_000 : Math.min(backoffMs * 2, 15 * 60_000);
      await sleep(backoffMs);
      if (deps.signal?.aborted) {
        return;
      }
      continue;
    }

    backoffMs = 0;
    await sleep(deps.intervalMs);
    if (deps.signal?.aborted) {
      return;
    }
  }
}
