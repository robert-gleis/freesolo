import fs from 'node:fs/promises';
import path from 'node:path';

import { getAgentAdapter, runReviewAgent } from '../agents/index.js';
import type { AgentAdapter } from '../agents/types.js';
import type { ReviewVerdict, RunReviewAgentInput } from '../agents/review-runner.js';
import type { HostTool } from '../core/types.js';
import { formatKnowledgeSection, loadKnowledgeEntries } from '../knowledge/loader.js';
import type { KnowledgeEntry } from '../knowledge/loader.js';
import { listAdrs } from '../memory/adrs.js';
import type { AdrRecord } from '../memory/adrs.js';
import { getPromptPreset } from '../prompts/presets.js';
import { getCandidateBranchDiff, resolveIssueBodyFromRepo } from './context-deps.js';
import type { AgentReviewRequest, AgentReviewResult } from './route-runner.js';

/**
 * External calls the real agent-review check makes, injected so tests can pass a
 * ScriptedAgentAdapter and fake loaders instead of touching git/gh/disk.
 */
export interface AgentReviewDeps {
  /** Resolves a fresh host-agnostic adapter for the check's host. */
  getAgentAdapter: (host: HostTool) => AgentAdapter;
  /** Candidate diff of HEAD vs its merge-base with the base branch (null falls back to 'main'). */
  getBranchDiff: (repoRoot: string, base: string | null) => Promise<string>;
  /** Issue/spec body, or null when unreadable. */
  getIssueBody: (repoRoot: string, issueNumber: number) => Promise<string | null>;
  /** Architecture Decision Records. */
  listAdrs: (repoRoot: string) => Promise<AdrRecord[]>;
  /** Knowledge Base entries. */
  loadKnowledgeEntries: (repoRoot: string) => Promise<KnowledgeEntry[]>;
  /** Runs the review agent and maps its output to a pass/fail verdict. */
  runReviewAgent: (input: RunReviewAgentInput) => Promise<ReviewVerdict>;
}

export const defaultAgentReviewDeps: AgentReviewDeps = {
  getAgentAdapter,
  getBranchDiff: getCandidateBranchDiff,
  getIssueBody: resolveIssueBodyFromRepo,
  listAdrs,
  loadKnowledgeEntries,
  runReviewAgent
};

/** Reads the prior route logs written for the CURRENT attempt in the run dir. */
async function readPriorLogs(runDirectory: string, attempt: number): Promise<string> {
  let entries: string[];
  try {
    entries = await fs.readdir(runDirectory);
  } catch {
    return '';
  }

  const prefix = `attempt-${attempt}-`;
  const matching = entries.filter((name) => name.startsWith(prefix) && name.endsWith('.log')).sort();

  const blocks: string[] = [];
  for (const name of matching) {
    let content: string;
    try {
      content = await fs.readFile(path.join(runDirectory, name), 'utf8');
    } catch {
      continue;
    }
    blocks.push(`### ${name}\n\n${content.trim()}`);
  }

  return blocks.join('\n\n');
}

/** Distills verdict findings into a single human-readable summary string. */
function summarizeFindings(verdict: ReviewVerdict): string | null {
  if (verdict.findings.length === 0) {
    return null;
  }
  return verdict.findings
    .map((f) => {
      const location = f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : null;
      const parts = [f.severity, location, f.message].filter(Boolean);
      return `- ${parts.join(': ')}`;
    })
    .join('\n');
}

/**
 * Real agent-review check: assembles review context, builds the preset prompt,
 * runs a fresh host agent, and turns its structured verdict into a check result.
 * runReviewAgent already collapses timeout/abort/unparseable/schema-invalid into
 * a `fail` verdict, so this never silently passes and needs no extra timeout
 * handling beyond forwarding timeoutSeconds and the abort signal.
 */
export async function runAgentReviewCheck(
  request: AgentReviewRequest,
  deps: AgentReviewDeps = defaultAgentReviewDeps
): Promise<AgentReviewResult> {
  const { check, runDirectory } = request;
  // Attempt-scope the artifact filename (mirroring the per-check log naming at
  // route-runner.ts `attempt-${attempt}-${check.name}.log`) so a multi-attempt
  // route's later attempt cannot clobber an earlier attempt's review evidence.
  const artifactPath = path.join(
    runDirectory,
    `attempt-${request.attempt}-review-${check.name}.json`
  );

  const verdict = await computeVerdict(request, deps);

  await writeArtifact(artifactPath, verdict);

  return {
    status: verdict.verdict === 'pass' ? 'pass' : 'fail',
    artifactPath,
    findings: summarizeFindings(verdict)
  };
}

/**
 * Assembles context, builds the prompt, and runs the review agent. Any failure in
 * context assembly or preset resolution collapses to a `fail` verdict (with the
 * error as a finding) so the check never throws past the gate — matching
 * runReviewAgent's own fail-soft policy for agent-side failures.
 */
async function computeVerdict(
  request: AgentReviewRequest,
  deps: AgentReviewDeps
): Promise<ReviewVerdict> {
  const { check, repoRoot, issueNumber, candidateBranch, baseBranch, attempt, runDirectory } = request;

  let prompt: string;
  try {
    const [diff, issueBody, adrs, knowledge, priorLogs] = await Promise.all([
      deps.getBranchDiff(repoRoot, baseBranch),
      deps.getIssueBody(repoRoot, issueNumber),
      deps.listAdrs(repoRoot),
      deps.loadKnowledgeEntries(repoRoot),
      readPriorLogs(runDirectory, attempt)
    ]);

    prompt = getPromptPreset(check.promptPreset)({
      issueNumber,
      candidateBranch,
      diff,
      issueBody,
      adrs: adrs.map((adr) => adr.content).join('\n\n'),
      knowledge: formatKnowledgeSection(knowledge),
      priorLogs
    });
  } catch (err) {
    return {
      verdict: 'fail',
      findings: [
        {
          severity: 'blocker',
          message: `agent-review context assembly failed: ${errorMessage(err)}`
        }
      ]
    };
  }

  const adapter = deps.getAgentAdapter(check.host);
  return deps.runReviewAgent({
    adapter,
    prompt,
    cwd: repoRoot,
    timeoutSeconds: check.timeoutSeconds,
    abortSignal: request.abortSignal
  });
}

async function writeArtifact(artifactPath: string, verdict: ReviewVerdict): Promise<void> {
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, JSON.stringify(verdict, null, 2));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
