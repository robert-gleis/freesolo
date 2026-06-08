import { execa } from 'execa';

import { buildCandidateBranchName } from './naming.js';
import {
  clearCandidateBranchRecord,
  readCandidateBranchRecord,
  writeCandidateBranchRecord
} from './store.js';
import {
  CandidateBranchError,
  type CandidateBranchOutcome,
  type CandidateBranchRecord,
  type CreateCandidateBranchInput
} from './types.js';

export type GitCommandRunner = (
  args: string[],
  options: { cwd: string }
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface CandidateBranchIntegratorDeps {
  runGit: GitCommandRunner;
  now?: () => Date;
}

export async function defaultRunGit(
  args: string[],
  options: { cwd: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await execa('git', args, { cwd: options.cwd, reject: false });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 1
  };
}

function formatGitOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
}

function assertGitSuccess(
  label: string,
  result: { stdout: string; stderr: string; exitCode: number }
): void {
  if (result.exitCode !== 0) {
    throw new CandidateBranchError(
      'git-error',
      `${label} failed (exit ${result.exitCode}).\n${formatGitOutput(result.stdout, result.stderr)}`
    );
  }
}

function buildBaseRecord(
  input: CreateCandidateBranchInput,
  branchName: string,
  baseBranch: string,
  now: Date,
  existing: CandidateBranchRecord | null
): CandidateBranchRecord {
  const timestamp = now.toISOString();
  return {
    branchName,
    issueNumber: input.issueNumber,
    issueSlug: input.issueSlug,
    teamId: input.teamId,
    sources: input.sources,
    baseBranch,
    mergeCommitSha: null,
    status: 'conflict',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };
}

export async function createCandidateBranch(
  input: CreateCandidateBranchInput,
  deps: CandidateBranchIntegratorDeps
): Promise<CandidateBranchOutcome> {
  const now = deps.now ?? (() => new Date());
  const baseBranch = input.baseBranch ?? 'main';

  if (input.sources.length === 0) {
    throw new CandidateBranchError('no-sources', 'At least one source branch is required.');
  }

  const branchName = buildCandidateBranchName(input.issueNumber, input.issueSlug);
  const existing = await readCandidateBranchRecord(input.repoRoot);

  if (existing?.status === 'ready' && !input.force) {
    return { status: 'already-exists', branchName, record: existing };
  }

  if (input.force) {
    await deps.runGit(['branch', '-D', branchName], { cwd: input.repoRoot });
    await clearCandidateBranchRecord(input.repoRoot);
  }

  for (const source of input.sources) {
    const verify = await deps.runGit(['rev-parse', '--verify', `refs/heads/${source.branchName}`], {
      cwd: input.repoRoot
    });
    if (verify.exitCode !== 0) {
      throw new CandidateBranchError('branch-not-found', `Branch not found: ${source.branchName}`);
    }
  }

  assertGitSuccess(
    `checkout ${branchName} from ${baseBranch}`,
    await deps.runGit(['checkout', '-B', branchName, baseBranch], { cwd: input.repoRoot })
  );

  for (const source of input.sources) {
    const merge = await deps.runGit(['merge', '--no-commit', '--no-ff', source.branchName], {
      cwd: input.repoRoot
    });

    const diff = await deps.runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: input.repoRoot });
    const conflictedFiles = diff.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (merge.exitCode !== 0 || conflictedFiles.length > 0) {
      const gitOutput = formatGitOutput(merge.stdout, merge.stderr);
      assertGitSuccess(
        'merge --abort',
        await deps.runGit(['merge', '--abort'], { cwd: input.repoRoot })
      );
      assertGitSuccess(
        `reset candidate branch to ${baseBranch}`,
        await deps.runGit(['checkout', '-B', branchName, baseBranch], { cwd: input.repoRoot })
      );

      const record = buildBaseRecord(input, branchName, baseBranch, now(), existing);
      await writeCandidateBranchRecord(input.repoRoot, record);

      return {
        status: 'conflict',
        branchName,
        conflictingBranch: source.branchName,
        conflictedFiles,
        gitOutput,
        record
      };
    }
  }

  const commitMessage = `candidate: integrate team ${input.teamId} for issue #${input.issueNumber}`;
  assertGitSuccess(
    'commit candidate merge',
    await deps.runGit(['commit', '-m', commitMessage], { cwd: input.repoRoot })
  );

  const head = await deps.runGit(['rev-parse', 'HEAD'], { cwd: input.repoRoot });
  assertGitSuccess('rev-parse HEAD', head);

  const timestamp = now().toISOString();
  const record: CandidateBranchRecord = {
    branchName,
    issueNumber: input.issueNumber,
    issueSlug: input.issueSlug,
    teamId: input.teamId,
    sources: input.sources,
    baseBranch,
    mergeCommitSha: head.stdout.trim(),
    status: 'ready',
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  await writeCandidateBranchRecord(input.repoRoot, record);

  return {
    status: 'created',
    branchName,
    mergeCommitSha: record.mergeCommitSha!,
    record
  };
}
