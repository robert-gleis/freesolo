import { getBranchDiff, parseGitHubRemote, readOriginRemote } from '../core/git.js';
import { getIssueBody } from '../core/github.js';
import type { RepoRef } from '../core/types.js';

/**
 * Shared default context loaders for the Gate Route agent checks (agent-review +
 * fixer). Both assemble the same review/fix context from a bare `repoRoot`:
 * the candidate branch diff and the issue/spec body. Keeping these defaults in
 * one place means the repo-ref resolution and the error-degradation policy have
 * a single source of truth instead of a copy in each check's default deps.
 */

/**
 * Candidate diff of HEAD vs its merge-base with the recorded base branch.
 * Falls back to 'main' only when the record has no base branch (null/absent),
 * so the review/fixer diff is 'what this branch introduced' against the
 * authoritative base rather than a hardcoded 'main'.
 */
export function getCandidateBranchDiff(repoRoot: string, base?: string | null): Promise<string> {
  return getBranchDiff({ cwd: repoRoot, base: base ?? 'main' });
}

/**
 * Hard cap on the candidate diff before it enters an agent prompt. The prompt is
 * passed to the host CLI as a single argv element, so an unbounded diff (e.g. a
 * lockfile churn) would hit ARG_MAX (~1 MiB on macOS) and fail the spawn with
 * E2BIG. Mirrors the prior-logs cap in agent-review-check.
 */
export const DIFF_MAX_CHARS = 256 * 1024;

/** Truncates an oversized diff, keeping the head and noting the original size. */
export function truncateDiff(diff: string): string {
  if (diff.length <= DIFF_MAX_CHARS) {
    return diff;
  }
  return `${diff.slice(0, DIFF_MAX_CHARS)}\n\n[diff truncated: showing first ${DIFF_MAX_CHARS} of ${diff.length} characters]`;
}

/** Injectable seams for {@link resolveIssueBodyFromRepo}, so tests skip git/gh. */
export interface ResolveIssueBodyDeps {
  readOriginRemote: (cwd: string) => Promise<string>;
  getIssueBody: (repo: RepoRef, issueNumber: number) => Promise<string | null>;
}

const defaultResolveIssueBodyDeps: ResolveIssueBodyDeps = {
  readOriginRemote,
  getIssueBody: (repo, issueNumber) => getIssueBody(repo, issueNumber)
};

/**
 * Resolves the repo ref from the origin remote so callers need only `repoRoot`,
 * then reads the issue/spec body. Degrades to null (no body) if the remote is
 * missing or unparseable, or if the issue cannot be read — callers treat a null
 * body as "no spec context" rather than a hard failure.
 */
export async function resolveIssueBodyFromRepo(
  repoRoot: string,
  issueNumber: number,
  deps: ResolveIssueBodyDeps = defaultResolveIssueBodyDeps
): Promise<string | null> {
  try {
    const remote = await deps.readOriginRemote(repoRoot);
    const repo = parseGitHubRemote(remote);
    if (!repo) return null;
    return await deps.getIssueBody({ owner: repo.owner, repo: repo.repo }, issueNumber);
  } catch {
    return null;
  }
}
