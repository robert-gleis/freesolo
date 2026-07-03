import path from 'node:path';

import { resolveRepoRoot } from '../core/git.js';
import { IssueIdError, resolveIssueNumber } from '../core/issue-id.js';
import { readCandidateBranchRecord } from '../integration/store.js';
import { updateSessionReportArtifact } from '../reports/session-artifacts.js';
import { writeTestReportToDisk } from '../reports/store.js';
import { DEFAULT_CONFIG_FILENAME, VerificationConfigError, loadVerificationConfig } from '../verification/config.js';
import { defaultGateRouteDeps, runGateRoute, type GateRouteInput } from '../verification/route-runner.js';
import { getRunDirectory } from '../verification/store.js';
import type { GateRouteRun, VerificationConfig } from '../verification/types.js';

export interface VerifyOptions {
  issue?: number;
  config?: string;
  printOnly?: boolean;
}

/**
 * Candidate branch identity threaded into the Gate Route. `baseBranch` is the
 * authoritative base recorded when the candidate was created; the route diffs
 * against it (falling back to 'main' only when no record exists).
 */
export interface CandidateBranchInfo {
  branchName: string | null;
  baseBranch: string | null;
}

export interface VerifyPlanDeps {
  resolveRepoRoot: (cwd: string) => Promise<string>;
  resolveIssueNumber: (repoRoot: string, override: number | undefined) => Promise<number>;
  loadVerificationConfig: (repoRoot: string, configPath?: string) => Promise<VerificationConfig>;
  resolveCandidateBranch: (repoRoot: string) => Promise<CandidateBranchInfo>;
  getRunDirectory: (repoRoot: string, issueNumber: number, runId: string) => Promise<string>;
  runRoute: (input: GateRouteInput) => Promise<GateRouteRun>;
  now: () => Date;
  newRunId: () => string;
  writeTestReport?: (run: GateRouteRun) => Promise<string | null>;
}

export type VerifyPlanResult =
  | {
      mode: 'print-only';
      summaryLines: string[];
      runDirectory: string;
      issueNumber: number;
      configPath: string;
    }
  | {
      mode: 'completed';
      run: GateRouteRun;
      exitCode: 0 | 1 | 130;
    }
  | {
      mode: 'error';
      message: string;
      exitCode: 2;
    };

function defaultRunId(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export const defaultVerifyPlanDeps: VerifyPlanDeps = {
  resolveRepoRoot,
  resolveIssueNumber: (repoRoot, override) => resolveIssueNumber(repoRoot, override),
  loadVerificationConfig,
  resolveCandidateBranch: async (repoRoot) => {
    const record = await readCandidateBranchRecord(repoRoot).catch(() => null);
    return { branchName: record?.branchName ?? null, baseBranch: record?.baseBranch ?? null };
  },
  getRunDirectory,
  runRoute: (input) => runGateRoute(input, defaultGateRouteDeps),
  now: () => new Date(),
  newRunId: () => defaultRunId(new Date()),
  writeTestReport: async (run) => {
    try {
      const reportPath = await writeTestReportToDisk(run);
      await updateSessionReportArtifact(run.repoRoot, 'testReport', reportPath);
      return reportPath;
    } catch (error) {
      console.error(
        `issueflow: failed to write TEST_REPORT.md: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }
};

function resolveConfigPath(repoRoot: string, configOption: string | undefined): string {
  const candidate = configOption ?? DEFAULT_CONFIG_FILENAME;
  return path.isAbsolute(candidate) ? candidate : path.join(repoRoot, candidate);
}

function buildPrintOnlySummary(input: {
  issueNumber: number;
  configPath: string;
  runDirectory: string;
  config: VerificationConfig;
}): string[] {
  const { gateRoute } = input.config.verification;
  const lines = [
    `Issue: #${input.issueNumber}`,
    `Config: ${input.configPath}`,
    `Run directory: ${input.runDirectory}`,
    `Max attempts: ${gateRoute.maxAttempts}`,
    `Bail on first failure: ${gateRoute.bail ? 'yes' : 'no'}`,
    'Checks:'
  ];

  for (const check of gateRoute.checks) {
    if (check.kind === 'shell') {
      const argsPart = check.args.length > 0 ? ` ${check.args.join(' ')}` : '';
      lines.push(`  - ${check.name} (shell): ${check.command}${argsPart}`);
    } else {
      lines.push(`  - ${check.name} (agent-review): ${check.host}/${check.promptPreset}`);
    }
  }

  return lines;
}

function runExitCode(run: GateRouteRun, aborted: boolean): 0 | 1 | 130 {
  if (aborted || run.checks.some((check) => check.signal === 'SIGINT')) {
    return 130;
  }
  return run.status === 'pass' ? 0 : 1;
}

export async function createVerifyPlan(
  input: { cwd: string; options: VerifyOptions; abortSignal?: AbortSignal },
  deps: VerifyPlanDeps = defaultVerifyPlanDeps
): Promise<VerifyPlanResult> {
  let repoRoot: string;
  let issueNumber: number;
  let config: VerificationConfig;
  let configPath: string;

  try {
    repoRoot = await deps.resolveRepoRoot(input.cwd);
    issueNumber = await deps.resolveIssueNumber(repoRoot, input.options.issue);
    config = await deps.loadVerificationConfig(repoRoot, input.options.config);
    configPath = resolveConfigPath(repoRoot, input.options.config);
  } catch (error) {
    if (error instanceof IssueIdError || error instanceof VerificationConfigError) {
      return { mode: 'error', message: error.message, exitCode: 2 };
    }

    if (error instanceof Error && error.message.startsWith('issueflow must be started inside a git repository')) {
      return { mode: 'error', message: error.message, exitCode: 2 };
    }

    throw error;
  }

  let runId: string;
  let runDirectory: string;
  try {
    runId = deps.newRunId();
    runDirectory = await deps.getRunDirectory(repoRoot, issueNumber, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      mode: 'error',
      message: `Failed to resolve verification run directory: ${message}`,
      exitCode: 2
    };
  }

  if (input.options.printOnly) {
    return {
      mode: 'print-only',
      summaryLines: buildPrintOnlySummary({ issueNumber, configPath, runDirectory, config }),
      runDirectory,
      issueNumber,
      configPath
    };
  }

  const candidate = await deps.resolveCandidateBranch(repoRoot);

  const run = await deps.runRoute({
    config: config.verification.gateRoute,
    routeConfigPath: configPath,
    repoRoot,
    issueNumber,
    candidateBranch: candidate.branchName,
    baseBranch: candidate.baseBranch,
    runDirectory,
    runId,
    abortSignal: input.abortSignal
  });

  if (deps.writeTestReport) {
    try {
      await deps.writeTestReport(run);
    } catch (error) {
      console.error(
        `issueflow: failed to write TEST_REPORT.md: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    mode: 'completed',
    run,
    exitCode: runExitCode(run, input.abortSignal?.aborted ?? false)
  };
}

function summarizeRun(run: GateRouteRun): string[] {
  const lines: string[] = [];

  for (const check of run.checks) {
    const indicator = check.status === 'pass' ? 'PASS' : check.status === 'fail' ? 'FAIL' : 'SKIP';
    const detail = check.exitCode === null ? '' : ` (exit ${check.exitCode})`;
    lines.push(`  ${indicator} ${check.name}${detail}`);
  }

  lines.push(`Run: ${run.runId} → ${run.status.toUpperCase()} (attempt ${run.attemptsUsed}/${run.maxAttempts})`);
  return lines;
}

export async function verifyAction(options: VerifyOptions): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once('SIGINT', onSigint);

  try {
    const result = await createVerifyPlan({
      cwd: process.cwd(),
      options,
      abortSignal: controller.signal
    });

    if (result.mode === 'error') {
      console.error(result.message);
      process.exitCode = result.exitCode;
      return;
    }

    if (result.mode === 'print-only') {
      for (const line of result.summaryLines) {
        console.log(line);
      }

      return;
    }

    for (const line of summarizeRun(result.run)) {
      console.log(line);
    }

    process.exitCode = result.exitCode;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}
