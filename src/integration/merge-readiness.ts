import type {
  MergeGateCheck,
  MergeReadinessEvaluation,
  MergeReadinessInput,
  MergeReadinessOutcome
} from './merge-types.js';

const NEXT_ACTIONS: Record<string, string> = {
  'workflow-state': 'Advance the issue to pr-ready with `freesolo gate evaluate`.',
  'verification-run': 'Run `freesolo verify` for this issue.',
  'verification-verdict':
    'Run `freesolo verify` then `freesolo gate evaluate` to refresh the verification verdict.',
  'review-artifact': 'Complete the implementation review loop and produce a review artifact.',
  'pull-request': 'Create a pull request with `freesolo pr create`.',
  'candidate-branch': 'Create a ready candidate branch with `freesolo candidate create`.'
};

function issueBranchPattern(issueNumber: number): RegExp {
  return new RegExp(`^issue/${issueNumber}-`);
}

function check(
  id: string,
  label: string,
  status: MergeGateCheck['status'],
  detail: string
): MergeGateCheck {
  return { id, label, status, detail };
}

function outcomeFromChecks(checks: MergeGateCheck[]): MergeReadinessOutcome {
  const blocking = checks.filter((c) => c.status === 'fail');
  return blocking.length === 0 ? 'ready' : 'blocked';
}

function firstFailingNextAction(checks: MergeGateCheck[]): string {
  const failing = checks.find((c) => c.status === 'fail');
  if (!failing) {
    return 'Run `freesolo merge` when ready.';
  }

  return NEXT_ACTIONS[failing.id] ?? 'Fix failing gates then run `freesolo merge evaluate`.';
}

export function evaluateMergeReadiness(input: MergeReadinessInput): MergeReadinessEvaluation {
  const checks: MergeGateCheck[] = [];

  checks.push(
    input.state === 'pr-ready'
      ? check('workflow-state', 'Workflow state', 'pass', 'pr-ready')
      : check(
          'workflow-state',
          'Workflow state',
          'fail',
          `expected pr-ready (current: ${input.state ?? 'none'})`
        )
  );

  if (!input.latestRun) {
    checks.push(check('verification-run', 'Verification run', 'fail', 'no verification run'));
  } else if (input.latestRun.status !== 'pass') {
    checks.push(
      check(
        'verification-run',
        'Verification run',
        'fail',
        `latest run ${input.latestRun.runId} status: ${input.latestRun.status}`
      )
    );
  } else {
    checks.push(
      check('verification-run', 'Verification run', 'pass', `run ${input.latestRun.runId}`)
    );
  }

  if (input.verdict !== 'pass') {
    checks.push(
      check(
        'verification-verdict',
        'Verification verdict',
        'fail',
        `expected pass (current: ${input.verdict ?? 'none'})`
      )
    );
  } else if (
    input.latestRun &&
    (input.verdictRunId === null || input.verdictRunId !== input.latestRun.runId)
  ) {
    checks.push(
      check(
        'verification-verdict',
        'Verification verdict',
        'fail',
        `Stale verdict — re-run \`freesolo gate evaluate\`. (verdict: ${input.verdictRunId}, latest: ${input.latestRun.runId})`
      )
    );
  } else {
    checks.push(check('verification-verdict', 'Verification verdict', 'pass', 'pass'));
  }

  const hasImplementationReview = input.artifacts.implementationReview !== null;
  const hasPlanReview = input.artifacts.planReview !== null;

  if (input.policy.requireImplementationReview) {
    if (hasImplementationReview) {
      checks.push(check('review-artifact', 'Review artifact', 'pass', 'implementation review'));
    } else if (hasPlanReview) {
      checks.push(check('review-artifact', 'Review artifact', 'pass', 'plan review (fallback)'));
    } else {
      checks.push(check('review-artifact', 'Review artifact', 'fail', 'no review artifact'));
    }
  } else if (hasImplementationReview || hasPlanReview) {
    checks.push(check('review-artifact', 'Review artifact', 'pass', 'review artifact present'));
  } else {
    checks.push(check('review-artifact', 'Review artifact', 'fail', 'no review artifact'));
  }

  if (!input.pullRequest) {
    checks.push(check('pull-request', 'Pull request', 'fail', 'no pull request record'));
  } else if (input.prState !== 'OPEN') {
    checks.push(
      check(
        'pull-request',
        'Pull request',
        'fail',
        `PR #${input.pullRequest.prNumber} state: ${input.prState ?? 'unknown'}`
      )
    );
  } else {
    checks.push(
      check(
        'pull-request',
        'Pull request',
        'pass',
        `PR #${input.pullRequest.prNumber} open`
      )
    );
  }

  const headBranch = input.pullRequest?.headBranch ?? null;
  const issueBranchHead = headBranch !== null && issueBranchPattern(input.issueNumber).test(headBranch);

  if (!input.policy.requireCandidateBranch) {
    checks.push(check('candidate-branch', 'Candidate branch', 'skip', 'not required by policy'));
  } else if (input.candidateRecord?.status === 'ready') {
    checks.push(
      check('candidate-branch', 'Candidate branch', 'pass', input.candidateRecord.branchName)
    );
  } else if (!input.candidateRecord && issueBranchHead) {
    checks.push(
      check('candidate-branch', 'Candidate branch', 'skip', `issue branch ${headBranch}`)
    );
  } else if (input.candidateRecord?.status === 'conflict') {
    checks.push(
      check('candidate-branch', 'Candidate branch', 'fail', 'candidate branch has conflicts')
    );
  } else {
    checks.push(
      check('candidate-branch', 'Candidate branch', 'fail', 'no ready candidate branch')
    );
  }

  const outcome = outcomeFromChecks(checks);
  const reason =
    outcome === 'ready'
      ? 'All merge readiness gates passed.'
      : `Blocked: ${checks.filter((c) => c.status === 'fail').map((c) => c.id).join(', ')}`;

  return {
    outcome,
    checks,
    reason,
    nextAction: firstFailingNextAction(checks)
  };
}
