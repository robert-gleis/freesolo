import fs from 'node:fs/promises';
import path from 'node:path';

import { getAgentAdapter } from '../agents/index.js';
import { runFixerAgent, type FixerAgentResult } from '../agents/fixer-runner.js';
import type { AgentAdapter } from '../agents/types.js';
import { errorMessage } from '../core/errors.js';
import type { HostTool } from '../core/types.js';
import { getPromptPreset, type FixerFailedCheck, type FixerPromptContext } from '../prompts/presets.js';
import { getCandidateBranchDiff, resolveIssueBodyFromRepo, truncateDiff } from './context-deps.js';
import { readLogTail } from './log-tail.js';
import type { FailureContext, FixerResult } from './route-runner.js';

/**
 * External calls the real fixer makes, injected so tests can pass a
 * ScriptedAgentAdapter and fake loaders instead of touching git/gh.
 */
export interface FixerCheckDeps {
  /** Resolves a fresh host-agnostic adapter for the fixer's host. */
  getAgentAdapter: (host: HostTool) => AgentAdapter;
  /** Candidate diff of HEAD vs its merge-base with the base branch (null falls back to 'main'). */
  getBranchDiff: (repoRoot: string, base: string | null) => Promise<string>;
  /** Issue/spec body, or null when unreadable. */
  getIssueBody: (repoRoot: string, issueNumber: number) => Promise<string | null>;
}

export const defaultFixerCheckDeps: FixerCheckDeps = {
  getAgentAdapter,
  getBranchDiff: getCandidateBranchDiff,
  getIssueBody: resolveIssueBodyFromRepo
};

/**
 * Real Fixer Agent seam (the default {@link FailureContext}-driven runFixer).
 * Assembles the Failure Context (failing checks + their log tails, the candidate
 * diff, and the issue/spec body), builds the `gate-fixer` prompt, runs a fresh
 * host agent, writes the fixer log, and maps completion to a {@link FixerResult}.
 *
 * The fixer NEVER decides route success — a normal agent completion yields
 * `status: 'pass'` only in the sense that the fixer step succeeded; the route
 * then reruns every check to decide. Any assembly error, preset error, adapter
 * error, timeout, or abort collapses to `status: 'fail'`, which fails the route
 * immediately (route-runner). This never throws past the gate.
 */
export async function runFixerCheck(
  context: FailureContext,
  deps: FixerCheckDeps = defaultFixerCheckDeps
): Promise<FixerResult> {
  let prompt: string;
  try {
    prompt = await buildFixerPrompt(context, deps);
  } catch (err) {
    return { status: 'fail', detail: `fixer context assembly failed: ${errorMessage(err)}`, log: '' };
  }

  const adapter = deps.getAgentAdapter(context.fixer.host);
  const result: FixerAgentResult = await runFixerAgent({
    adapter,
    prompt,
    cwd: context.repoRoot,
    timeoutSeconds: context.fixer.timeoutSeconds,
    abortSignal: context.abortSignal
  });

  const log = result.output ?? '';
  await writeFixerLog(context.logPath, log);

  return { status: result.ok ? 'pass' : 'fail', detail: result.detail, log };
}

async function buildFixerPrompt(context: FailureContext, deps: FixerCheckDeps): Promise<string> {
  const [diff, issueBody] = await Promise.all([
    deps.getBranchDiff(context.repoRoot, context.baseBranch),
    deps.getIssueBody(context.repoRoot, context.issueNumber)
  ]);

  const failedChecks: FixerFailedCheck[] = await Promise.all(
    context.failedChecks.map(async (c) => ({
      name: c.name,
      kind: c.kind,
      command: c.command,
      exitCode: c.exitCode,
      logPath: c.logPath,
      logSummary: await readLogTail(c.logPath),
      reviewFindings: c.reviewFindings ?? null
    }))
  );

  const promptContext: FixerPromptContext = {
    issueNumber: context.issueNumber,
    candidateBranch: context.candidateBranch,
    diff: truncateDiff(diff),
    issueBody,
    failedChecks
  };

  return getPromptPreset<FixerPromptContext>(context.fixer.promptPreset)(promptContext);
}

async function writeFixerLog(logPath: string, content: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.writeFile(logPath, content);
  } catch {
    // best-effort evidence: a failed log write must not change the fixer result
  }
}
