import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { execa } from 'execa';

import { findIssueArtifacts } from '../core/artifacts.js';
import { parseGitHubRemote, readOriginRemote } from '../core/git.js';
import { loadLatestRun } from '../verification/store.js';
import { buildPullRequestBody, buildPullRequestTitle, extractSummary } from './pr-body.js';
import { readPullRequestRecord, writePullRequestRecord } from './pr-store.js';
import type {
  CreatePullRequestInput,
  GhCommandRunner,
  PullRequestCreatorDeps,
  PullRequestOutcome,
  PullRequestRecord
} from './pr-types.js';
import { PullRequestError } from './pr-types.js';
import { readCandidateBranchRecord } from './store.js';

export async function defaultRunGh(
  args: string[],
  options: { cwd: string; input?: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa('gh', args, {
    cwd: options.cwd,
    input: options.input,
    reject: false
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1
  };
}

async function readOptionalFile(
  readFile: PullRequestCreatorDeps['readFile'],
  filePath: string | null
): Promise<string | undefined> {
  if (!filePath) {
    return undefined;
  }

  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

function parsePrUrl(stdout: string): { prNumber: number; prUrl: string } | null {
  const urlMatch = stdout.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
  if (!urlMatch) {
    return null;
  }

  return {
    prUrl: urlMatch[0],
    prNumber: Number.parseInt(urlMatch[1], 10)
  };
}

async function findOpenPullRequest(
  repoRoot: string,
  headBranch: string,
  runGh: GhCommandRunner
): Promise<{ prNumber: number; prUrl: string } | null> {
  const remoteUrl = await readOriginRemote(repoRoot);
  const repo = parseGitHubRemote(remoteUrl);

  if (!repo) {
    return null;
  }

  const result = await runGh(
    [
      'pr',
      'list',
      '--head',
      `${repo.owner}:${headBranch}`,
      '--json',
      'number,url,state',
      '--state',
      'open'
    ],
    { cwd: repoRoot }
  );

  if (result.exitCode !== 0) {
    return null;
  }

  try {
    const entries = JSON.parse(result.stdout) as Array<{ number: number; url: string; state: string }>;
    const open = entries.find((entry) => entry.state?.toUpperCase() === 'OPEN');
    return open ? { prNumber: open.number, prUrl: open.url } : null;
  } catch {
    return null;
  }
}

function buildRecord(input: {
  issueNumber: number;
  issueSlug: string;
  prNumber: number;
  prUrl: string;
  title: string;
  headBranch: string;
  baseBranch: string;
  verificationRunId: string;
  reviewPath: string;
  specPath: string | null;
  createdAt: string;
}): PullRequestRecord {
  return {
    issueNumber: input.issueNumber,
    issueSlug: input.issueSlug,
    prNumber: input.prNumber,
    prUrl: input.prUrl,
    title: input.title,
    headBranch: input.headBranch,
    baseBranch: input.baseBranch,
    verificationRunId: input.verificationRunId,
    implementationReviewPath: input.reviewPath,
    specPath: input.specPath,
    createdAt: input.createdAt
  };
}

export async function createPullRequest(
  input: CreatePullRequestInput,
  deps: PullRequestCreatorDeps
): Promise<PullRequestOutcome> {
  const now = deps.now ?? (() => new Date());
  const candidate = await readCandidateBranchRecord(input.repoRoot);

  if (!candidate || candidate.status !== 'ready' || candidate.issueNumber !== input.issueNumber) {
    throw new PullRequestError('candidate-not-ready', 'candidate branch is not ready for pull request creation');
  }

  const verificationRun = await loadLatestRun(input.repoRoot, input.issueNumber);

  if (!verificationRun || verificationRun.status !== 'pass') {
    throw new PullRequestError('verification-not-passed', 'latest verification run did not pass');
  }

  const artifacts = await findIssueArtifacts(input.repoRoot, input.issueNumber);
  const reviewPath = artifacts.implementationReview ?? artifacts.planReview;

  if (!reviewPath) {
    throw new PullRequestError('review-artifact-missing', 'no implementation or plan review artifact found');
  }

  const [specMarkdown, planMarkdown, reviewMarkdown] = await Promise.all([
    readOptionalFile(deps.readFile, artifacts.spec),
    readOptionalFile(deps.readFile, artifacts.plan),
    deps.readFile(reviewPath, 'utf8')
  ]);

  const summary = extractSummary({
    specMarkdown,
    planMarkdown,
    issueNumber: input.issueNumber,
    issueSlug: candidate.issueSlug
  });

  const headBranch = candidate.branchName;
  const baseBranch = input.baseBranch ?? candidate.baseBranch;
  const title = buildPullRequestTitle(input.issueNumber, candidate.issueSlug);
  const body = buildPullRequestBody({
    issueNumber: input.issueNumber,
    summary,
    verificationRun,
    reviewMarkdown
  });

  const existingRecord = await readPullRequestRecord(input.repoRoot);
  if (existingRecord && existingRecord.issueNumber === input.issueNumber && existingRecord.headBranch === headBranch) {
    return {
      status: 'already-exists',
      prNumber: existingRecord.prNumber,
      prUrl: existingRecord.prUrl,
      record: existingRecord
    };
  }

  if (input.dryRun) {
    return { status: 'dry-run', title, body, headBranch, baseBranch };
  }

  const openPr = await findOpenPullRequest(input.repoRoot, headBranch, deps.runGh);
  if (openPr) {
    const record = buildRecord({
      issueNumber: input.issueNumber,
      issueSlug: candidate.issueSlug,
      prNumber: openPr.prNumber,
      prUrl: openPr.prUrl,
      title,
      headBranch,
      baseBranch,
      verificationRunId: verificationRun.runId,
      reviewPath,
      specPath: artifacts.spec,
      createdAt: now().toISOString()
    });
    await writePullRequestRecord(input.repoRoot, record);

    return {
      status: 'already-exists',
      prNumber: openPr.prNumber,
      prUrl: openPr.prUrl,
      record
    };
  }

  const pushResult = await deps.runGit(['push', '-u', 'origin', headBranch], { cwd: input.repoRoot });
  if (pushResult.exitCode !== 0) {
    throw new PullRequestError('git-error', pushResult.stderr || 'git push failed');
  }

  const bodyFile = path.join(os.tmpdir(), `issueflow-pr-body-${input.issueNumber}-${Date.now()}.md`);

  try {
    await deps.writeFile(bodyFile, body, 'utf8');

    const createResult = await deps.runGh(
      [
        'pr',
        'create',
        '--base',
        baseBranch,
        '--head',
        headBranch,
        '--title',
        title,
        '--body-file',
        bodyFile
      ],
      { cwd: input.repoRoot }
    );

    if (createResult.exitCode !== 0) {
      throw new PullRequestError('gh-error', createResult.stderr || 'gh pr create failed');
    }

    const parsed = parsePrUrl(createResult.stdout);
    if (!parsed) {
      throw new PullRequestError('gh-error', 'gh pr create did not return a pull request URL');
    }

    const record = buildRecord({
      issueNumber: input.issueNumber,
      issueSlug: candidate.issueSlug,
      prNumber: parsed.prNumber,
      prUrl: parsed.prUrl,
      title,
      headBranch,
      baseBranch,
      verificationRunId: verificationRun.runId,
      reviewPath,
      specPath: artifacts.spec,
      createdAt: now().toISOString()
    });

    await writePullRequestRecord(input.repoRoot, record);

    return {
      status: 'created',
      prNumber: parsed.prNumber,
      prUrl: parsed.prUrl,
      record
    };
  } finally {
    await fs.unlink(bodyFile).catch(() => undefined);
  }
}
