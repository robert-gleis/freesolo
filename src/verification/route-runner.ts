import path from 'node:path';

import { writeRun } from './store.js';
import {
  defaultExecCheck,
  resolveCheckCwd,
  runShellCheck,
  type ExecCheck
} from './runner.js';
import type {
  AgentReviewCheck,
  AttemptRecord,
  FixerInvocationResult,
  FixerSpec,
  GateRouteConfig,
  GateRouteRun,
  RouteCheck,
  RouteCheckResult,
  RunStatus,
  ShellCheck
} from './types.js';

export interface GateRouteInput {
  config: GateRouteConfig;
  routeConfigPath: string;
  repoRoot: string;
  issueNumber: number;
  candidateBranch: string | null;
  runDirectory: string;
  runId: string;
  abortSignal?: AbortSignal;
}

export interface AgentReviewRequest {
  check: AgentReviewCheck;
  repoRoot: string;
  issueNumber: number;
  candidateBranch: string | null;
  attempt: number;
  runDirectory: string;
  logPath: string;
  abortSignal?: AbortSignal;
}

export interface AgentReviewResult {
  status: RunStatus;
  artifactPath: string | null;
  findings: string | null;
}

/** A single failed check, distilled for the Fixer Agent. */
export interface FailedCheckSummary {
  name: string;
  kind: RouteCheck['kind'];
  command: string | null;
  exitCode: number | null;
  logPath: string;
  reviewFindings?: string | null;
}

export interface FailureContext {
  attempt: number;
  repoRoot: string;
  issueNumber: number;
  candidateBranch: string | null;
  fixer: FixerSpec;
  failedChecks: FailedCheckSummary[];
  logPath: string;
  runDirectory: string;
  abortSignal?: AbortSignal;
}

export interface FixerResult {
  status: RunStatus;
  detail: string;
  log: string;
}

export interface GateRouteDeps {
  execCheck: ExecCheck;
  runAgentReview: (request: AgentReviewRequest) => Promise<AgentReviewResult>;
  runFixer: (context: FailureContext) => Promise<FixerResult>;
  writeRun: (run: GateRouteRun) => Promise<void>;
  now: () => Date;
}

export const defaultGateRouteDeps: GateRouteDeps = {
  execCheck: defaultExecCheck,
  // ponytail: agent-review is an injected seam. The default is a hard failure so
  // shell-only routes work end-to-end today and a misconfigured agent-review
  // check fails loudly instead of silently passing. Real impl lands in A3.
  runAgentReview: async () => ({
    status: 'fail',
    artifactPath: null,
    findings: 'agent-review not implemented yet (A2)'
  }),
  // ponytail: fixer is an injected seam. Default fails so a route that needs a
  // fix cannot succeed until the real Fixer Agent lands in A3.
  runFixer: async () => ({
    status: 'fail',
    detail: 'fixer not implemented yet (A3)',
    log: ''
  }),
  // ponytail: the canonical run-writer is store.writeRun. GateRouteRun extends
  // VerificationRun, so store.writeRun (typed for VerificationRun) is assignable
  // here — no wrapper needed. Reused instead of reimplemented per the shared-helper rule.
  writeRun,
  now: () => new Date()
};

function timeoutAwareSignal(
  base: AbortSignal | undefined,
  timeoutSeconds: number | undefined
): { signal: AbortSignal | undefined; dispose: () => void } {
  if (timeoutSeconds === undefined) {
    return { signal: base, dispose: () => {} };
  }

  const timeout = AbortSignal.timeout(timeoutSeconds * 1000);
  const signal = base ? AbortSignal.any([base, timeout]) : timeout;
  return { signal, dispose: () => {} };
}

function skippedResult(check: RouteCheck, now: string, logPath: string): RouteCheckResult {
  return {
    name: check.name,
    kind: check.kind,
    status: 'skipped',
    command: check.kind === 'shell' ? check.command : null,
    exitCode: null,
    signal: null,
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
    logPath
  };
}

async function runOneShellCheck(
  check: ShellCheck,
  input: GateRouteInput,
  deps: GateRouteDeps,
  logPath: string
): Promise<RouteCheckResult> {
  const startedAt = deps.now();
  const { signal } = timeoutAwareSignal(input.abortSignal, check.timeoutSeconds);
  const outcome = await runShellCheck(
    {
      command: check.command,
      args: check.args,
      cwd: resolveCheckCwd(input.repoRoot, check.cwd),
      env: check.env
    },
    logPath,
    deps.execCheck,
    signal
  );
  const finishedAt = deps.now();

  return {
    name: check.name,
    kind: 'shell',
    status: outcome.status,
    command: check.command,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    logPath
  };
}

async function runOneReviewCheck(
  check: AgentReviewCheck,
  input: GateRouteInput,
  deps: GateRouteDeps,
  attempt: number,
  logPath: string,
  reviewArtifactPaths: string[]
): Promise<RouteCheckResult> {
  const startedAt = deps.now();
  const { signal } = timeoutAwareSignal(input.abortSignal, check.timeoutSeconds);
  const result = await deps.runAgentReview({
    check,
    repoRoot: input.repoRoot,
    issueNumber: input.issueNumber,
    candidateBranch: input.candidateBranch,
    attempt,
    runDirectory: input.runDirectory,
    logPath,
    abortSignal: signal
  });
  const finishedAt = deps.now();

  if (result.artifactPath) {
    reviewArtifactPaths.push(result.artifactPath);
  }

  return {
    name: check.name,
    kind: 'agent-review',
    status: result.status,
    command: null,
    exitCode: null,
    signal: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    logPath,
    reviewFindings: result.findings ?? null
  };
}

async function runAttempt(
  attempt: number,
  input: GateRouteInput,
  deps: GateRouteDeps,
  reviewArtifactPaths: string[]
): Promise<AttemptRecord> {
  const checks: RouteCheckResult[] = [];
  let bailed = false;

  for (const check of input.config.checks) {
    const logPath = path.join(input.runDirectory, `attempt-${attempt}-${check.name}.log`);

    if (bailed) {
      checks.push(skippedResult(check, deps.now().toISOString(), logPath));
      continue;
    }

    const result =
      check.kind === 'shell'
        ? await runOneShellCheck(check, input, deps, logPath)
        : await runOneReviewCheck(check, input, deps, attempt, logPath, reviewArtifactPaths);

    checks.push(result);

    if (result.status === 'fail' && input.config.bail) {
      bailed = true;
    }
  }

  const status: RunStatus = checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';
  return { attempt, status, checks };
}

function toFailedCheckSummaries(attempt: AttemptRecord): FailedCheckSummary[] {
  return attempt.checks
    .filter((c) => c.status === 'fail')
    .map((c) => ({
      name: c.name,
      kind: c.kind,
      command: c.command,
      exitCode: c.exitCode,
      logPath: c.logPath,
      reviewFindings: c.reviewFindings ?? null
    }));
}

/**
 * Runs the deterministic Gate Route: run every configured check in order; on a
 * green attempt, pass; on a red attempt with attempts remaining, build a
 * structured FailureContext and invoke the Fixer Agent, then RESTART the whole
 * route from the first check. A fixer failure/timeout fails the route
 * immediately. After maxAttempts still red, the route fails.
 */
export async function runGateRoute(
  input: GateRouteInput,
  deps: GateRouteDeps = defaultGateRouteDeps
): Promise<GateRouteRun> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(input.runDirectory, { recursive: true });

  const startedAt = deps.now().toISOString();
  const attempts: AttemptRecord[] = [];
  const reviewArtifactPaths: string[] = [];
  const fixerInvocations: FixerInvocationResult[] = [];

  let status: RunStatus = 'fail';

  for (let attempt = 1; attempt <= input.config.maxAttempts; attempt += 1) {
    const record = await runAttempt(attempt, input, deps, reviewArtifactPaths);
    attempts.push(record);

    if (record.status === 'pass') {
      status = 'pass';
      break;
    }

    // Attempt failed. If no attempts remain, stop with failure.
    if (attempt >= input.config.maxAttempts) {
      status = 'fail';
      break;
    }

    // Attempts remain: build a structured Failure Context and run the fixer.
    const fixerLogPath = path.join(input.runDirectory, `attempt-${attempt}-fixer.log`);
    const failureContext: FailureContext = {
      attempt,
      repoRoot: input.repoRoot,
      issueNumber: input.issueNumber,
      candidateBranch: input.candidateBranch,
      fixer: input.config.fixer,
      failedChecks: toFailedCheckSummaries(record),
      logPath: fixerLogPath,
      runDirectory: input.runDirectory,
      abortSignal: input.abortSignal
    };

    const fixer = await deps.runFixer(failureContext);
    fixerInvocations.push({
      afterAttempt: attempt,
      status: fixer.status,
      logPath: fixerLogPath,
      detail: fixer.detail
    });

    if (fixer.status !== 'pass') {
      // Fixer failed or timed out — the route fails immediately.
      status = 'fail';
      break;
    }
    // Fixer succeeded: the loop advances to attempt+1 and reruns from the first check.
  }

  const finalAttempt = attempts[attempts.length - 1];
  const finishedAt = deps.now().toISOString();

  const run: GateRouteRun = {
    schemaVersion: 2,
    runId: input.runId,
    issueNumber: input.issueNumber,
    repoRoot: input.repoRoot,
    configPath: input.routeConfigPath,
    startedAt,
    finishedAt,
    status,
    bail: input.config.bail,
    // Mirror the final attempt's checks so downstream consumers (pr-body,
    // test-report, gate) that read `run.checks` work unchanged.
    checks: (finalAttempt?.checks ?? []).map((c) => ({
      name: c.name,
      command: c.command ?? c.kind,
      args: [],
      cwd: input.repoRoot,
      status: c.status,
      exitCode: c.exitCode,
      signal: c.signal,
      startedAt: c.startedAt,
      finishedAt: c.finishedAt,
      durationMs: c.durationMs,
      logPath: c.logPath
    })),
    candidateBranch: input.candidateBranch,
    routeConfigPath: input.routeConfigPath,
    maxAttempts: input.config.maxAttempts,
    attemptsUsed: attempts.length,
    attempts,
    reviewArtifactPaths,
    fixerInvocations
  };

  await deps.writeRun(run);
  return run;
}
