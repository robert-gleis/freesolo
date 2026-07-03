/**
 * Prompt presets for agent-backed Gate Route checks.
 *
 * A preset is a pure builder: it takes a context and returns the full prompt
 * string handed to a fresh host agent. Review presets take a
 * {@link ReviewPromptContext}; the fixer preset takes a {@link FixerPromptContext}.
 * The map stays a plain lookup, not a plugin system.
 */

export interface ReviewPromptContext {
  issueNumber: number;
  candidateBranch: string | null;
  /** The candidate diff (HEAD vs merge-base with the base branch). */
  diff: string;
  /** Issue or spec body, when available. */
  issueBody: string | null;
  /** Rendered ADRs section, or '' when none exist. */
  adrs: string;
  /** Rendered Knowledge Base section, or '' when none exist. */
  knowledge: string;
  /** Prior route logs for the current attempt, or '' when none exist. */
  priorLogs: string;
}

export type PromptBuilder = (context: ReviewPromptContext) => string;

/** A single failed check as handed to the {@link FixerPromptContext}. */
export interface FixerFailedCheck {
  name: string;
  kind: 'shell' | 'agent-review';
  /** Shell command that failed, or null for non-shell checks. */
  command: string | null;
  /** Process exit code, or null when not a process (e.g. agent-review). */
  exitCode: number | null;
  /** Path to this check's per-check log. */
  logPath: string;
  /** A short summary/tail of the failing check's log, or '' when none. */
  logSummary: string;
  /** Review findings when the failed check was an agent-review, else null. */
  reviewFindings: string | null;
}

export interface FixerPromptContext {
  issueNumber: number;
  candidateBranch: string | null;
  /** The candidate diff (HEAD vs merge-base with the base branch). */
  diff: string;
  /** Issue or spec body, when available. */
  issueBody: string | null;
  /** The checks that failed this attempt, distilled for the fixer. */
  failedChecks: FixerFailedCheck[];
}

export type FixerPromptBuilder = (context: FixerPromptContext) => string;

/** Renders an optional context block, collapsing empty values to a placeholder. */
function section(title: string, body: string | null | undefined): string {
  const trimmed = (body ?? '').trim();
  return `## ${title}\n\n${trimmed === '' ? '_none provided_' : trimmed}`;
}

const buildThermonuclearReview: PromptBuilder = (context) => {
  const branch = context.candidateBranch ?? '_unknown_';

  return [
    'You are a strict, adversarial code reviewer acting as a deterministic gate.',
    'Review the candidate change for BLOCKING correctness and quality issues.',
    'A blocking issue is a correctness defect, a data-loss or security risk, a',
    'broken contract, or a change that fails its own stated intent. Style nits and',
    'subjective preferences are NOT blocking.',
    '',
    `Issue number: ${context.issueNumber}`,
    `Candidate branch: ${branch}`,
    '',
    section('Issue / Spec', context.issueBody),
    '',
    section('Architecture Decision Records', context.adrs),
    '',
    section('Knowledge Base', context.knowledge),
    '',
    section('Prior route logs (this attempt)', context.priorLogs),
    '',
    section('Candidate diff', context.diff),
    '',
    '## Response format',
    '',
    'Respond with ONLY a single JSON object and nothing else. Do not add prose,',
    'markdown fences, or explanation outside the JSON. The object must match:',
    '',
    '{',
    '  "verdict": "pass" | "fail",',
    '  "findings": [',
    '    { "severity": string?, "file": string?, "line": number?, "message": string }',
    '  ]',
    '}',
    '',
    'Set "verdict" to "pass" when there are NO blocking correctness or quality',
    'findings, otherwise "fail". Every blocking finding must appear in "findings".',
    'When you pass, "findings" may be empty.'
  ].join('\n');
};

/** Renders one failed check as a bullet block for the fixer prompt. */
function renderFailedCheck(check: FixerFailedCheck): string {
  const lines = [`### ${check.name} (${check.kind})`];
  if (check.command) {
    lines.push(`- command: ${check.command}`);
  }
  if (check.exitCode !== null) {
    lines.push(`- exit code: ${check.exitCode}`);
  }
  lines.push(`- log: ${check.logPath}`);
  const summary = check.logSummary.trim();
  if (summary !== '') {
    lines.push('- log summary:', '', '```', summary, '```');
  }
  const findings = (check.reviewFindings ?? '').trim();
  if (findings !== '') {
    lines.push('- review findings:', '', findings);
  }
  return lines.join('\n');
}

const buildGateFixer: FixerPromptBuilder = (context) => {
  const branch = context.candidateBranch ?? '_unknown_';
  const failed = context.failedChecks.map(renderFailedCheck).join('\n\n');

  return [
    'You are a Fixer Agent for a deterministic pre-PR gate. The Gate Route ran',
    'and at least one check FAILED. Make the MINIMAL code change that makes the',
    'failing checks pass on the next run.',
    '',
    `Issue number: ${context.issueNumber}`,
    `Candidate branch: ${branch}`,
    '',
    '## Failed checks',
    '',
    failed === '' ? '_none provided_' : failed,
    '',
    section('Issue / Spec', context.issueBody),
    '',
    section('Candidate diff', context.diff),
    '',
    '## Rules',
    '',
    '- Make the smallest change that fixes the failing checks. Do NOT touch',
    '  unrelated code, refactor broadly, or fix pre-existing issues that are not',
    '  causing a failure above.',
    '- Do NOT edit the route config: leave issueflow.config.json and the',
    '  `verification.gateRoute` block (checks, fixer, maxAttempts, bail) untouched.',
    '  Weakening or disabling a check is not a fix.',
    '- Do NOT declare the route fixed or claim success. You do not decide whether',
    '  the route passes — the gate reruns the COMPLETE route from the first check',
    '  after you finish, and that rerun is the sole arbiter of success. Just make',
    '  the change and stop.'
  ].join('\n');
};

// Review and fixer builders take different context shapes but share the same
// lookup. The map stays a plain entry list; getPromptPreset is generic over the
// context type so each caller resolves the concrete builder it expects.
const PRESETS: Record<string, PromptBuilder | FixerPromptBuilder> = {
  'thermonuclear-review': buildThermonuclearReview,
  'gate-fixer': buildGateFixer
};

export function getPromptPreset<T = ReviewPromptContext>(name: string): (context: T) => string {
  const builder = PRESETS[name];
  if (!builder) {
    throw new Error(
      `unknown prompt preset: ${name} (known: ${Object.keys(PRESETS).join(', ')})`
    );
  }
  return builder as (context: T) => string;
}

/** The preset names known to the registry. */
export const KNOWN_PRESETS: readonly string[] = Object.keys(PRESETS);

/** True when `name` resolves to a registered preset builder. */
export function hasPreset(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PRESETS, name);
}
