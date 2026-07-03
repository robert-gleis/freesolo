/**
 * Prompt presets for agent-backed Gate Route checks.
 *
 * A preset is a pure builder: it takes a {@link ReviewPromptContext} and returns
 * the full prompt string handed to a fresh host agent. The map stays a plain
 * one-entry lookup, not a plugin system.
 *
 * A3 will add a 'gate-fixer' preset (with its own Fixer context shape) here.
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

const PRESETS: Record<string, PromptBuilder> = {
  'thermonuclear-review': buildThermonuclearReview
  // A3 adds 'gate-fixer' here.
};

export function getPromptPreset(name: string): PromptBuilder {
  const builder = PRESETS[name];
  if (!builder) {
    throw new Error(
      `unknown prompt preset: ${name} (known: ${Object.keys(PRESETS).join(', ')})`
    );
  }
  return builder;
}
